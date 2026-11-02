// CSS class for an order status or student readiness value: COMPLETED / Seat unlocked = green,
// REFUNDED / Seat revoked = red, anything else (AWAITING PAYMENT / Payment pending) = amber. The
// colours come from the theme's --status-* tokens (src/theme/themes.js), so they hold in all themes.
export function statusClass(value) {
  if (value === 'COMPLETED' || value === 'Seat unlocked') return 'status-completed';
  if (value === 'REFUNDED' || value === 'Seat revoked') return 'status-refunded';
  return 'status-pending';
}
