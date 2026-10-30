// AG Studio data source for Instructor analytics: one table of the signed-in instructor's seat
// orders from /api/analytics/orders, plus a calendar on the order date.

const CALENDAR_ID = 'calendar';
const USD = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) };

// [id, name, format, hide?]. Per-order numbers are hidden: the named measures below are what
// widgets use, so legends and headers read "Revenue" rather than "Revenue (sum)".
const ORDER_FIELDS = [
  ['orderId', 'Order ID', 'textFormat', true],
  ['className', 'Class', 'textFormat'],
  ['status', 'Seat Status', 'textFormat'],
  ['currency', 'Currency', 'textFormat', true],
  ['seats', 'Seats per Order', 'integerFormat', true],
  ['seatsUnlocked', 'Unlocked per Order', 'integerFormat', true],
  ['seatsPending', 'Pending per Order', 'integerFormat', true],
  ['amount', 'Order Amount', 'currencyFormat', true],
  ['revenue', 'Captured Amount', 'currencyFormat', true],
  ['pendingAmount', 'Unpaid Amount', 'currencyFormat', true],
  ['orderDate', 'Order Date', 'dateFormat'],
  ['capturedDate', 'Paid Date', 'dateFormat'],
];

// [id, name, format, source field, aggregation]
const MEASURES = [
  ['seatsOrdered', 'Seats Ordered', 'integerFormat', 'orders.seats', 'sum'],
  ['seatsUnlocked', 'Seats Unlocked', 'integerFormat', 'orders.seatsUnlocked', 'sum'],
  ['seatsPending', 'Seats Pending', 'integerFormat', 'orders.seatsPending', 'sum'],
  ['orderTotal', 'Order Total', 'currencyFormat', 'orders.amount', 'sum'],
  ['revenue', 'Revenue', 'currencyFormat', 'orders.revenue', 'sum'],
  ['awaitingPayment', 'Awaiting Payment', 'currencyFormat', 'orders.pendingAmount', 'sum'],
  ['orderCount', 'Orders', 'integerFormat', 'orders.orderId', 'countd'],
];

export function buildStudioData(orders) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = orders.map((order) => order.orderDate).filter(Boolean).sort();

  return {
    description:
      "One instructor's seat orders from PayPal Sandbox, in USD. Each seat costs USD 49.00. " +
      'Revenue counts only captured (unlocked) orders; Awaiting Payment is approved-but-unpaid or pending orders.',
    sources: [
      {
        id: 'orders',
        name: 'Seat Orders',
        description: 'One row per seat order. Class is the class name the instructor gave the order.',
        data: orders,
        fields: ORDER_FIELDS.map(([id, name, format, hide]) => ({
          id,
          name,
          format,
          ...(format === 'currencyFormat' && { formatOptions: USD }),
          ...(hide && { hide }),
        })),
      },
    ],
    relationships: [
      {
        id: 'orders-orderDate-calendar',
        source: { tableId: 'orders', fieldId: 'orderDate' },
        target: { calendarId: CALENDAR_ID },
      },
    ],
    expressions: MEASURES.map(([id, name, format, source, aggregation]) => ({
      id,
      name,
      format,
      ...(format === 'currencyFormat' && { formatOptions: USD }),
      isMeasure: true,
      expression: { id: source, aggregation },
    })),
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: {
          from: { type: 'date', value: dates[0] ?? today },
          to: { type: 'date', value: today > (dates.at(-1) ?? '') ? today : dates.at(-1) },
        },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
  };
}
