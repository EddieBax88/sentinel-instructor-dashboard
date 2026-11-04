// Row logic for the Seat progress widget, kept out of the React file so it is unit tested.
// Remaining seats count only unlocked (captured) seats against the class size: pending orders are
// shown on the bar and as their own figure, but they hold no seat until PayPal captures them.
export function seatProgressModel({ classSize, unlocked, pending }) {
  const size = Math.max(0, Number(classSize) || 0);
  const unlockedSeats = Math.max(0, Number(unlocked) || 0);
  const pendingSeats = Math.max(0, Number(pending) || 0);
  const scale = Math.max(size, unlockedSeats + pendingSeats, 1);
  const percent = (seats) => `${(seats / scale) * 100}%`;
  return {
    classSize: size,
    unlocked: unlockedSeats,
    pending: pendingSeats,
    remaining: Math.max(0, size - unlockedSeats),
    unlockedWidth: percent(unlockedSeats),
    pendingWidth: percent(pendingSeats),
    label: `${unlockedSeats} seats unlocked, ${pendingSeats} awaiting payment, ${Math.max(0, size - unlockedSeats)} of ${size} remaining`,
  };
}
