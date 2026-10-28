// The default Instructor analytics report, as AG Studio report state. Field ids ('orders.revenue')
// refer to ./studioData.js; 'revenueTile' and 'seatProgress' are the custom widgets in ./widgets.jsx.

const at = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan });
const sum = (id) => ({ id, aggregation: 'sum' });
const title = (text) => ({ title: { enabled: true, text } });

const FONT = '"DM Sans", sans-serif';
const typography = (fontSize, fontWeight = 'normal') => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: 'normal' });

const kpi = (text, value) => ({
  type: 'value',
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text, typography: typography(13, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(22) },
  },
});

const overview = {
  id: 'overview',
  widgets: {
    revenue: {
      type: 'revenueTile',
      dataMapping: { value: [sum('orders.revenue')], detail: [sum('orders.seatsUnlocked')] },
      format: title('Revenue'),
    },
    'seat-progress': {
      type: 'seatProgress',
      dataMapping: { unlocked: [sum('orders.seatsUnlocked')], pending: [sum('orders.seatsPending')] },
      format: title('Seats unlocked vs pending'),
    },
    'kpi-awaiting': kpi('Awaiting payment', sum('orders.pendingAmount')),
    'kpi-orders': kpi('Orders', { id: 'orders.orderId', aggregation: 'countd' }),
    'seats-over-time': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        valueKey: [sum('orders.seatsUnlocked'), sum('orders.seatsPending')],
      },
      format: {
        ...title('Seats ordered by day'),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    'revenue-over-time': {
      // Columns rather than a line: with sparse days a line breaks at every day without orders.
      type: 'column-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        valueKey: [sum('orders.amount'), sum('orders.revenue')],
      },
      format: {
        ...title('Order value and revenue by day'),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    'by-class': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'orders.className' },
          sum('orders.seats'),
          sum('orders.seatsUnlocked'),
          sum('orders.seatsPending'),
          sum('orders.revenue'),
          sum('orders.pendingAmount'),
        ],
      },
      sort: [{ field: sum('orders.revenue'), direction: 'desc' }],
      format: title('Orders by class'),
    },
  },
  widgetLayout: {
    revenue: at(0, 0, 8, 9),
    'seat-progress': at(8, 0, 8, 9),
    'kpi-awaiting': at(16, 0, 4, 9),
    'kpi-orders': at(20, 0, 4, 9),
    'seats-over-time': at(0, 9, 12, 20),
    'revenue-over-time': at(12, 9, 12, 20),
    'by-class': at(0, 29, 24, 18),
  },
};

export const initialReport = {
  selectedPageId: overview.id,
  pages: [overview],
  panels: { filters: { collapsed: true }, data: { collapsed: true } },
};
