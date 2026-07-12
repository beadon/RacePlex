// Formatting helpers shared by the calculator tools.

/** "+1.25" / "−0.50" — an explicit sign, and a real minus sign rather than a hyphen. */
export function signed(value: number, digits: number): string {
  const r = value.toFixed(digits);
  return value >= 0 ? `+${r}` : r.replace("-", "−");
}
