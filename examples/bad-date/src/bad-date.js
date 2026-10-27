export function parseDate(isoString) {
  const [year, month, day] = isoString.split('-').map(Number);
  return { year, month, day: day - 1 };
}
