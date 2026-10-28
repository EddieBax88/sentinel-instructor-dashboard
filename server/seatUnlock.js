import { DEFAULT_CLASS_SIZE } from './config.js';

export const COHORT = Object.freeze({
  id: 'sentinel-fall-2026',
  name: 'Sentinel Fall 2026',
  classSize: DEFAULT_CLASS_SIZE,
});

const pendingOrders = new Map();
const transactions = new Map();

function seatCount(orders) {
  let seats = 0;
  for (const order of orders.values()) seats += order.quantity ?? 1;
  return seats;
}

// Seats still needed to reach the default class size. Informational: orders may go past it.
export function seatsRemaining() {
  return Math.max(0, COHORT.classSize - seatCount(transactions) - seatCount(pendingOrders));
}

export function recordPendingOrder(order) {
  if (!order?.orderId || !order.userId || !order.studentName || !order.amount || !order.currency) {
    throw new Error('Pending orders must include an order, student, and fixed price.');
  }
  if (pendingOrders.has(order.orderId) || transactions.has(order.orderId)) return;
  const quantity = order.quantity ?? 1;
  pendingOrders.set(order.orderId, { ...order, quantity, status: 'PENDING', createdAt: new Date().toISOString() });
}

export function getPendingOrder(orderId) {
  return pendingOrders.get(orderId);
}

export function discardPendingOrder(orderId) {
  pendingOrders.delete(orderId);
}

export function findTransactionByOrderId(orderId) {
  return transactions.get(orderId);
}

export function unlockSeatsFromVerifiedCapture({ orderId, captureId, status, amount, currency, source }) {
  const existing = transactions.get(orderId);
  if (existing) return existing;

  const order = pendingOrders.get(orderId);
  if (!order) throw Object.assign(new Error('Capture does not match a pending Sentinel order.'), { statusCode: 404 });
  if (status !== 'COMPLETED' || !captureId) {
    throw Object.assign(new Error('A completed PayPal capture is required before unlocking a seat.'), { statusCode: 409 });
  }
  if (amount !== order.amount || currency !== order.currency) {
    throw Object.assign(new Error('Capture amount or currency does not match the pending seat order.'), { statusCode: 409 });
  }

  const transaction = {
    orderId,
    captureId,
    userId: order.userId,
    studentName: order.studentName,
    cohortId: order.cohortId,
    quantity: order.quantity,
    amount,
    currency,
    status: 'COMPLETED',
    source,
    unlockedAt: new Date().toISOString(),
  };
  transactions.set(orderId, transaction);
  pendingOrders.delete(orderId);
  console.info(`Seat unlocked: cohort=${order.cohortId} order=${orderId} capture=${captureId} source=${source}`);
  return transaction;
}

export function getOrdersForUser(userId) {
  return [...pendingOrders.values(), ...transactions.values()]
    .filter((order) => order.userId === userId)
    .map(({ orderId, studentName, quantity, amount, currency, status }) => ({ orderId, name: studentName, quantity, amount, currency, status }));
}

export function getDashboardState() {
  const orders = [...pendingOrders.values()];
  const completed = [...transactions.values()];
  const transactionRows = [
    ...orders.map((order) => ({ ...order, captureId: '', status: 'AWAITING PAYMENT' })),
    ...completed,
  ].sort((first, second) => (second.unlockedAt || second.createdAt).localeCompare(first.unlockedAt || first.createdAt));
  const students = [
    ...orders.map((order) => ({
      id: order.orderId,
      name: order.studentName,
      cohort: COHORT.name,
      readiness: 'Payment pending',
    })),
    ...completed.map((transaction) => ({
      id: transaction.captureId,
      name: transaction.studentName,
      cohort: COHORT.name,
      readiness: 'Seat unlocked',
    })),
  ];

  return {
    transactions: transactionRows,
    quotas: [{
      id: COHORT.id,
      cohort: COHORT.name,
      classSize: COHORT.classSize,
      seatsSold: seatCount(transactions),
      seatsReserved: seatCount(pendingOrders),
      seatsRemaining: seatsRemaining(),
    }],
    students,
  };
}

export function resetSeatState() {
  pendingOrders.clear();
  transactions.clear();
}