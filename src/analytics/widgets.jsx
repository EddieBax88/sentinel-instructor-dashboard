// Custom AG Studio widgets for Instructor analytics, styled with the dashboard's CSS tokens:
// - revenueTile: a large money value with an optional supporting number underneath.
// - seatProgress: unlocked and pending seats as a bar against the default class size; remaining counts
//   unlocked seats only (seatProgress.js).
// - classFill: one bar per class, seats unlocked against the class size.
// Studio passes new params on every refresh (data, filters, mapping), so each widget re-queries
// whenever its props change.

import { createWidgets } from 'ag-studio-react';
import { useEffect, useState } from 'react';
import { classFillRows } from './classFill.js';
import { seatProgressModel } from './seatProgress.js';

// Widget-picker icons: Studio inlines the SVG, so currentColor follows the theme's text colour.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 15l3-3 3 2 4-5"/></svg>`;
const BARS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h13"/></svg>`;

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
  const [unlockedValue, pendingValue] = values;
  const model = seatProgressModel({ classSize: props.context?.classSize, unlocked: unlockedValue.value, pending: pendingValue.value });

  return (
    <div className="studio-seats">
      <div className="studio-seats-bar" role="img" aria-label={model.label}>
        <span className="unlocked" style={{ width: model.unlockedWidth }} />
        <span className="pending" style={{ width: model.pendingWidth }} />
      </div>
      <dl>
        <div><dt><i className="unlocked" />Unlocked</dt><dd>{model.unlocked}</dd></div>
        <div><dt><i className="pending" />Awaiting payment</dt><dd>{model.pending}</dd></div>
        <div><dt>Class size</dt><dd>{model.classSize}</dd></div>
        <div><dt>Still to fill</dt><dd>{model.remaining}</dd></div>
      </dl>
    </div>
  );
}

// Fetches grouped rows for one category field and one measure (Studio groups by the unaggregated
// field), and keeps Studio's overlay in sync.
function useGroupedRows(props, categoryKey, valueKey) {
  const { dataMapping, widgetApi } = props;
  const [result, setResult] = useState(null);

  useEffect(() => {
    const category = dataMapping[categoryKey]?.[0];
    const value = dataMapping[valueKey]?.[0];
    if (!category || !value) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return undefined;
    }
    const controller = new AbortController();
    widgetApi.setDisplayState('loading', { prominent: result === null });
    widgetApi.getData({ fields: [category, value] }, { signal: controller.signal })
      .then(({ results }) => {
        if (!results.rows.length) {
          widgetApi.setDisplayState('noData');
          return;
        }
        setResult({ rows: results.rows, categoryKey: category.key, valueKey: value.key });
        widgetApi.setDisplayState('displayed');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && !controller.signal.aborted) widgetApi.setDisplayState('noData');
      });
    return () => controller.abort();
    // Studio hands over a new props object on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  return result;
}

function ClassFill(props) {
  const result = useGroupedRows(props, 'className', 'unlocked');
  if (!result) return null;
  const classSize = props.context?.classSize ?? 0;
  const rows = classFillRows(result.rows, { classKey: result.categoryKey, unlockedKey: result.valueKey, classSize });

  return (
    <div className="studio-class-fill">
      {rows.map((row) => (
        <div className="studio-class-fill-row" key={row.className}>
          <span title={row.className}>{row.className}</span>
          <strong>{row.unlocked}<small> / {row.classSize} seats</small></strong>
          <div className="studio-class-fill-bar" role="img" aria-label={`${row.className}: ${row.unlocked} of ${row.classSize} seats unlocked`}>
            <span className={row.full ? 'full' : ''} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ))}
      <p className="studio-class-fill-note">Unlocked seats against the planned class size of {classSize}.</p>
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

const classFillDefinition = {
  id: 'classFill',
  label: 'Class Fill',
  icon: BARS_ICON,
  dataMapping: {
    className: {
      type: 'field',
      supportedRoles: ['category'],
      requires: { cardinality: 'one' },
      required: true,
      intent: 'category',
      aiDescription: 'The class each bar is for, e.g. Class.',
    },
    unlocked: { ...numericField('Seats paid for and unlocked in that class, e.g. the sum of Seats Unlocked.'), intent: 'value' },
  },
  form: (params) => params.createDefaults({
    dataMappingItems: [
      { key: 'className', label: 'Class' },
      { key: 'unlocked', label: 'Unlocked seats' },
    ],
  }),
  comp: ClassFill,
  defaultSize: { width: 360, height: 260 },
  minSize: { width: 240, height: 160 },
  ai: { description: 'One bar per class: seats unlocked against the planned class size, fullest first.' },
};

export const studioWidgets = (defaults) => createWidgets({
  additionalTypes: [revenueTileDefinition, seatProgressDefinition, classFillDefinition],
  menu: [
    ...defaults.menu,
    { label: 'Instructor', widgetIds: ['revenueTile', 'seatProgress', 'classFill'] },
  ],
});
