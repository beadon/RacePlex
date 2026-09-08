import { describe, it, expect } from "vitest";
import { IDLE_HOLD_STATE, startHold, cancelHold, updateHold } from "./holdToConfirm";

describe("startHold", () => {
  it("begins at zero progress", () => {
    expect(startHold(1000)).toEqual({ startedAtMs: 1000, progress: 0 });
  });
});

describe("cancelHold", () => {
  it("returns to idle", () => {
    expect(cancelHold()).toEqual(IDLE_HOLD_STATE);
  });
});

describe("updateHold", () => {
  it("is a no-op while idle", () => {
    const { state, justCompleted } = updateHold(IDLE_HOLD_STATE, 5000, 1500);
    expect(state).toEqual(IDLE_HOLD_STATE);
    expect(justCompleted).toBe(false);
  });

  it("reports fractional progress partway through the hold", () => {
    const held = startHold(1000);
    const { state, justCompleted } = updateHold(held, 1750, 1500);
    expect(state.progress).toBeCloseTo(0.5, 5);
    expect(justCompleted).toBe(false);
  });

  it("clamps at 1 and fires justCompleted exactly on the completing tick", () => {
    const held = startHold(1000);
    const mid = updateHold(held, 1750, 1500);
    expect(mid.justCompleted).toBe(false);

    const done = updateHold(mid.state, 2500, 1500);
    expect(done.state.progress).toBe(1);
    expect(done.justCompleted).toBe(true);

    // Polling again after completion (caller hasn't reset yet) must not re-fire.
    const again = updateHold(done.state, 3000, 1500);
    expect(again.state.progress).toBe(1);
    expect(again.justCompleted).toBe(false);
  });

  it("never reports progress above 1 even well past the duration", () => {
    const held = startHold(0);
    const { state } = updateHold(held, 1_000_000, 1500);
    expect(state.progress).toBe(1);
  });

  it("treats a non-positive duration as instantly complete", () => {
    const held = startHold(1000);
    const { state, justCompleted } = updateHold(held, 1000, 0);
    expect(state.progress).toBe(1);
    expect(justCompleted).toBe(true);
  });
});
