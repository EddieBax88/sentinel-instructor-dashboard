// Plain logic behind the Class fill widget (src/analytics/widgets.jsx), kept out of the component
// so it can be tested in Node. One row per class: seats unlocked against the class size.

// Rows from Studio ({ [classKey]: name, [unlockedKey]: seats }) -> sorted display rows.
// Fullest classes first, then by name; a class past its size shows a full bar, never more.
export function classFillRows(rows, { classKey, unlockedKey, classSize }) {
  const size = Math.max(0, Number(classSize) || 0);
  return rows
    .map((row) => {
      const unlocked = Math.max(0, Number(row[unlockedKey]) || 0);
      const scale = Math.max(size, unlocked, 1);
      return {
        className: row[classKey] === null || row[classKey] === undefined || row[classKey] === '' ? '(no class name)' : String(row[classKey]),
        unlocked,
        classSize: size,
        percent: Math.min(100, Math.round((unlocked / scale) * 100)),
        full: size > 0 && unlocked >= size,
      };
    })
    .sort((a, b) => b.unlocked - a.unlocked || a.className.localeCompare(b.className));
}
