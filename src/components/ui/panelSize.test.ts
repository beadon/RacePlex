/**
 * react-resizable-panels v4 reversed what a bare number means on a size prop:
 *
 *   v3:  defaultSize={30}  → 30 percent
 *   v4:  defaultSize={30}  → 30 PIXELS
 *
 * The prop is typed `number | string`, so the migration compiled clean and the
 * Pro view's left column silently rendered as a ~30px sliver. The wrapper's
 * contract is to keep the v3 meaning, so a bare number must reach v4 as a
 * unitless string (which v4 reads as percent).
 */

import { describe, it, expect } from "vitest";
import { asPercentIfBareNumber } from "./panelSize";

describe("asPercentIfBareNumber", () => {
  it("sends a bare number through as a percent string, not pixels", () => {
    // The regression: 30 must stay 30 PERCENT, so it must not reach v4 as a number.
    expect(asPercentIfBareNumber(30)).toBe("30");
    expect(typeof asPercentIfBareNumber(30)).toBe("string");
  });

  it("keeps 0 a percent string (a collapsed panel, not 'unset')", () => {
    // collapsedSize={0} — falsy, so an `if (size)` guard here would drop it.
    expect(asPercentIfBareNumber(0)).toBe("0");
  });

  it("leaves an explicit unit string alone", () => {
    expect(asPercentIfBareNumber("200px")).toBe("200px");
    expect(asPercentIfBareNumber("20rem")).toBe("20rem");
    expect(asPercentIfBareNumber("50%")).toBe("50%");
  });

  it("passes undefined through, so v4 applies its own default", () => {
    expect(asPercentIfBareNumber(undefined)).toBeUndefined();
  });
});
