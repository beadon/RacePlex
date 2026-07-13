/**
 * Size-unit shim for react-resizable-panels v4.
 *
 * v4 reversed what a bare number means on a size prop, silently and without a
 * type error:
 *
 *   v3:  defaultSize={30}   → 30 PERCENT
 *   v4:  defaultSize={30}   → 30 PIXELS      (a bare number is now px)
 *        defaultSize="30"   → 30 percent     (a unitless string is percent)
 *
 * The prop is typed `number | string`, so every v3-style callsite still compiled
 * and the Pro view's left column rendered as a ~30px sliver. `resizable.tsx`
 * preserves the v3 contract, so a bare number keeps meaning percent. Pass an
 * explicit string ("200px", "20rem") for pixels.
 *
 * Lives in its own module rather than in resizable.tsx: a file that exports both
 * components and plain functions breaks Fast Refresh.
 */
export function asPercentIfBareNumber(size: number | string | undefined): string | undefined {
  if (size === undefined) return undefined;
  // BASE case: v4 reads a unitless string as a percentage.
  return typeof size === "number" ? String(size) : size;
}
