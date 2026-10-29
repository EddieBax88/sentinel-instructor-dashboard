// The default Instructor analytics report, as AG Studio report state. Field ids ('orders.revenue')
// refer to ./studioData.js; 'revenueTile' and 'seatProgress' are the custom widgets in ./widgets.jsx.

const at = (xTrack, yTrack, xSpan, ySpan) => ({ xTrack, yTrack, xSpan, ySpan });
// Named measures from ./studioData.js.
const measure = (id) => ({ id });
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
      dataMapping: { value: [measure('revenue')], detail: [measure('seatsUnlocked')] },
      format: title('Revenue'),
    },
    'seat-progress': {
      type: 'seatProgress',
      dataMapping: { unlocked: [measure('seatsUnlocked')], pending: [measure('seatsPending')] },
      format: title('Seats unlocked vs pending'),
    },
    'kpi-awaiting': kpi('Awaiting payment', measure('awaitingPayment')),
    'kpi-orders': kpi('Orders', measure('orderCount')),
    'seats-over-time': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'calendar::day' }],
        valueKey: [measure('seatsUnlocked'), measure('seatsPending')],
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
        valueKey: [measure('orderTotal'), measure('revenue')],
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
          measure('seatsOrdered'),
          measure('seatsUnlocked'),
          measure('seatsPending'),
          measure('revenue'),
          measure('awaitingPayment'),
        ],
      },
      sort: [{ field: measure('revenue'), direction: 'desc' }],
      format: title('Orders by class'),
    },
  },
  widgetLayout: {
    revenue: at(0, 0, 7, 9),
    'seat-progress': at(7, 0, 8, 9),
    'kpi-awaiting': at(15, 0, 6, 9),
    'kpi-orders': at(21, 0, 3, 9),
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
