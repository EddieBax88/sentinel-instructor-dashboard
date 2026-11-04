// The class name Card 01 starts with: the class of the instructor's newest order in the seat ledger
// (ledger transactions carry studentName = class name and createdAt). Returns '' when there is none.
// Anything that looks like an email address is skipped, so a sign-in email that once landed in the
// class field is never offered back.
const EMAIL = /\S+@\S+/;

export function latestClassName(transactions = []) {
  let latest = null;
  for (const order of transactions) {
    const name = typeof order?.studentName === 'string' ? order.studentName.trim() : '';
    if (!name || EMAIL.test(name)) continue;
    const time = Date.parse(order.createdAt);
    const at = Number.isNaN(time) ? -Infinity : time;
    if (!latest || at > latest.at) latest = { name, at };
  }
  return latest?.name ?? '';
}
