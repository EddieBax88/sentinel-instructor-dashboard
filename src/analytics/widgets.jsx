// Custom AG Studio widgets for Instructor analytics, styled with the dashboard's CSS tokens:
// - revenueTile: a large money value with an optional supporting number underneath.
// - seatProgress: unlocked and pending seats as a bar against the default class size.
// Studio passes new params on every refresh (data, filters, mapping), so each widget re-queries
// whenever its props change.

import { createWidgets } from 'ag-studio-react';
import { useEffect, useState } from 'react';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#176b50" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 15l3-3 3 2 4-5"/></svg>`;

// Fetches one row of aggregated values for the mapped fields and keeps Studio's overlay in sync.
function useMappedValues(props, keys, requiredKeys = keys) {
  const { dataMapping, widgetApi } = props;
  const [values, setValues] = useState(null);

  useEffect(() => {
    const fields = keys.map((key) => dataMapping[key]?.[0]);
    if (requiredKeys.some((key) => !dataMapping[key]?.[0])) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return undefined;
    }
    const controller = new AbortController();
    widgetApi.setDisplayState('loading', { prominent: values === null });
    widgetApi.getData({ fields: fields.filter(Boolean) }, { signal: controller.signal })
      .then(({ results }) => {
        const row = results.rows[0];
        if (!row) {
          widgetApi.setDisplayState('noData');
          return;
        }
        setValues(fields.map((field) => (field ? { field, value: row[field.key] } : null)));
        widgetApi.setDisplayState('displayed');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && !controller.signal.aborted) widgetApi.setDisplayState('noData');
      });
    return () => controller.abort();
    // Studio hands over a new props object on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  return values;
}

// "Seats Unlocked (sum)" -> "seats unlocked", for a sentence-style caption.
const fieldLabel = (widgetApi, field) => widgetApi.getFieldName(field).replace(/\s*\([^)]*\)$/, '').toLowerCase();

function RevenueTile(props) {
  const values = useMappedValues(props, ['value', 'detail'], ['value']);
  if (!values) return null;
  const [main, detail] = values;
  const { widgetApi } = props;
  return (
    <div className="studio-revenue">
      <strong>{widgetApi.formatFieldValue(main.field, main.value ?? 0)}</strong>
      {detail && <span>{widgetApi.formatFieldValue(detail.field, detail.value ?? 0)} {fieldLabel(widgetApi, detail.field)}</span>}
    </div>
  );
}

function SeatProgress(props) {
  const values = useMappedValues(props, ['unlocked', 'pending']);
  if (!values) return null;
  const classSize = props.context?.classSize ?? 0;
  const [unlocked, pending] = values.map((entry) => Number(entry.value) || 0);
  const scale = Math.max(classSize, unlocked + pending, 1);
  const percent = (seats) => `${(seats / scale) * 100}%`;
  const remaining = Math.max(0, classSize - unlocked - pending);

  return (
    <div className="studio-seats">
      <div className="studio-seats-bar" role="img" aria-label={`${unlocked} seats unlocked and ${pending} pending of a ${classSize}-seat class`}>
        <span className="unlocked" style={{ width: percent(unlocked) }} />
        <span className="pending" style={{ width: percent(pending) }} />
      </div>
      <dl>
        <div><dt><i className="unlocked" />Unlocked</dt><dd>{unlocked}</dd></div>
        <div><dt><i className="pending" />Pending</dt><dd>{pending}</dd></div>
        <div><dt>Class size</dt><dd>{classSize}</dd></div>
        <div><dt>Still to fill</dt><dd>{remaining}</dd></div>
      </dl>
    </div>
  );
}

const numericField = (aiDescription, required = true) => ({
  type: 'field',
  supportedRoles: ['numeric'],
  requires: { cardinality: 'one' },
  required,
  aiDescription,
});

const revenueTileDefinition = {
  id: 'revenueTile',
  label: 'Revenue Tile',
  icon: ICON,
  dataMapping: {
    value: numericField('Money value to show large, e.g. the sum of Revenue.'),
    detail: numericField('Optional supporting number shown underneath, e.g. the sum of Seats Unlocked.', false),
  },
  form: (params) => params.createDefaults({
    dataMappingItems: [
      { key: 'value', label: 'Value' },
      { key: 'detail', label: 'Detail' },
    ],
  }),
  comp: RevenueTile,
  defaultSize: { width: 360, height: 180 },
  minSize: { width: 200, height: 120 },
  ai: { description: 'Large branded money value with an optional supporting number, for revenue.' },
};

const seatProgressDefinition = {
  id: 'seatProgress',
  label: 'Seat Progress',
  icon: ICON,
  dataMapping: {
    unlocked: numericField('Seats paid for and unlocked, e.g. the sum of Seats Unlocked.'),
    pending: numericField('Seats ordered but not yet paid, e.g. the sum of Seats Pending.'),
  },
  form: (params) => params.createDefaults({
    dataMappingItems: [
      { key: 'unlocked', label: 'Unlocked seats' },
      { key: 'pending', label: 'Pending seats' },
    ],
  }),
  comp: SeatProgress,
  defaultSize: { width: 360, height: 180 },
  minSize: { width: 260, height: 140 },
  ai: { description: 'Bar of unlocked and pending seats against the default class size.' },
};

export const studioWidgets = (defaults) => createWidgets({
  additionalTypes: [revenueTileDefinition, seatProgressDefinition],
  menu: [
    ...defaults.menu,
    { label: 'Instructor', widgetIds: ['revenueTile', 'seatProgress'] },
  ],
});
