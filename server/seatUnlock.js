export const COHORT = Object.freeze({
  id: 'sentinel-fall-2026',
  name: 'Sentinel Fall 2026',
  capacity: 12,
});

const pendingOrders = new Map();
const transactions = new Map();

export function assertSeatAvailable() {
  const reservedSeats = pendingOrders.size;
  if (transactions.size + reservedSeats >= COHORT.capacity) {
    throw Object.assign(new Error('The cohort has no seats available.'), { statusCode: 409 });
  }
}

export function recordPendingOrder(order) {
  if (!order?.orderId || !order.studentName || !order.amount || !order.currency) {
    throw new Error('Pending orders must include an order, student, and fixed price.');
  }
  if (pendingOrders.has(order.orderId) || transactions.has(order.orderId)) return;
  assertSeatAvailable();
  pendingOrders.set(order.orderId, { ...order, status: 'PENDING', createdAt: new Date().toISOString() });
}

export function getPendingOrder(orderId) {
  return pendingOrders.get(orderId);
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
  if (transactions.size >= COHORT.capacity) {
    throw Object.assign(new Error('The cohort has no seats available.'), { statusCode: 409 });
  }

  const transaction = {
    orderId,
    captureId,
    studentName: order.studentName,
    cohortId: order.cohortId,
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
      capacity: COHORT.capacity,
      seatsSold: completed.length,
      seatsReserved: orders.length,
      seatsAvailable: COHORT.capacity - completed.length - orders.length,
    }],
    students,
  };
}

export function resetSeatState() {
  pendingOrders.clear();
  transactions.clear();
}