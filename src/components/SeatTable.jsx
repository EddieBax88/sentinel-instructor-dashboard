import { ClientSideRowModelModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { statusClass } from './statusClass.js';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

// Theming API params (the grid ignores legacy --ag-* CSS variables when a theme object is set).
// Colors point at the brand tokens in src/styles.css.
const gridTheme = themeQuartz.withParams({
  fontFamily: 'var(--font)',
  fontSize: 10,
  headerFontSize: 9,
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  textColor: 'var(--foreground)',
  backgroundColor: 'var(--card)',
  borderColor: 'var(--border)',
  rowBorder: { color: 'var(--border)' },
  rowHoverColor: 'var(--accent-soft)',
  accentColor: 'var(--primary)',
  headerHeight: 32,
  rowHeight: 34,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

function StatusCell({ value }) {
  return value ? <span className={`status-cell ${statusClass(value)}`}>{value}</span> : null;
}

const defaultColDef = { flex: 1, minWidth: 112, sortable: true, resizable: true };
const transactionColumns = [
  // studentName holds the class name the order was placed for (class_name in the seat agent).
  { field: 'studentName', headerName: 'CLASS', minWidth: 150 },
  { field: 'cohortId', headerName: 'COHORT', minWidth: 145 },
  { field: 'quantity', headerName: 'SEATS', minWidth: 80 },
  { field: 'captureId', headerName: 'CAPTURE ID', minWidth: 155, valueFormatter: ({ value }) => value || '—' },
  { field: 'amount', headerName: 'AMOUNT', minWidth: 100, valueFormatter: ({ data }) => data ? `${data.currency} ${data.amount}` : '—' },
  { field: 'status', headerName: 'PAYMENT STATUS', minWidth: 150, cellRenderer: StatusCell },
];
const quotaColumns = [
  { field: 'cohort', headerName: 'COHORT', minWidth: 170 },
  { field: 'classSize', headerName: 'CLASS SIZE' },
  { field: 'seatsSold', headerName: 'UNLOCKED' },
  { field: 'seatsReserved', headerName: 'PENDING' },
  { field: 'seatsRefunded', headerName: 'REFUNDED' },
  { field: 'seatsRemaining', headerName: 'REMAINING' },
];
const studentColumns = [
  { field: 'name', headerName: 'CLASS', minWidth: 150 },
  { field: 'cohort', headerName: 'COHORT', minWidth: 170 },
  { field: 'readiness', headerName: 'READINESS', minWidth: 155, cellRenderer: StatusCell },
];

function GridTable({ rows, columns, emptyText }) {
  return rows.length ? (
    <div className="grid-frame">
      <AgGridReact rowData={rows} columnDefs={columns} defaultColDef={defaultColDef} theme={gridTheme} domLayout="autoHeight" />
    </div>
  ) : <div className="grid-empty">{emptyText}</div>;
}

export default function SeatTable({ transactions, quotas, students }) {
  return (
    <div className="tables-stack">
      <section className="table-block"><div className="table-heading"><h3>Transactions</h3><span>{transactions.length} orders</span></div><GridTable rows={transactions} columns={transactionColumns} emptyText="No seat orders yet." /></section>
      <section className="table-block"><div className="table-heading"><h3>Class seats</h3><span>Default class size</span></div><GridTable rows={quotas} columns={quotaColumns} emptyText="Quota data unavailable." /></section>
      <section className="table-block"><div className="table-heading"><h3>Student readiness</h3><span>{students.length} students</span></div><GridTable rows={students} columns={studentColumns} emptyText="Students appear here when a seat order starts." /></section>
    </div>
  );
}