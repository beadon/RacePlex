import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addToComparisonBin,
  clearComparisonBin,
  removeFromComparisonBin,
  snapshotComparisonBin,
  subscribeComparisonBin,
  toggleComparisonBin,
  __resetComparisonBinForTests,
} from "./useComparisonBin";

beforeEach(() => __resetComparisonBinForTests());

describe("comparison bin", () => {
  it("starts empty", () => {
    expect(snapshotComparisonBin()).toEqual([]);
  });

  it("add is idempotent and sorts snapshot", () => {
    addToComparisonBin("b.csv");
    addToComparisonBin("a.csv");
    addToComparisonBin("a.csv"); // duplicate
    expect(snapshotComparisonBin()).toEqual(["a.csv", "b.csv"]);
  });

  it("remove is a no-op for absent files", () => {
    addToComparisonBin("a.csv");
    removeFromComparisonBin("nope.csv");
    removeFromComparisonBin("a.csv");
    expect(snapshotComparisonBin()).toEqual([]);
  });

  it("toggle flips presence", () => {
    toggleComparisonBin("x.csv");
    expect(snapshotComparisonBin()).toEqual(["x.csv"]);
    toggleComparisonBin("x.csv");
    expect(snapshotComparisonBin()).toEqual([]);
  });

  it("clear empties the bin", () => {
    addToComparisonBin("a.csv");
    addToComparisonBin("b.csv");
    clearComparisonBin();
    expect(snapshotComparisonBin()).toEqual([]);
  });

  it("notifies subscribers on add / remove / toggle / clear", () => {
    const listener = vi.fn();
    const unsub = subscribeComparisonBin(listener);
    addToComparisonBin("a.csv");
    toggleComparisonBin("b.csv");
    removeFromComparisonBin("a.csv");
    clearComparisonBin();
    expect(listener).toHaveBeenCalledTimes(4);
    unsub();
  });

  it("does NOT notify when a no-op mutation is attempted", () => {
    addToComparisonBin("a.csv");
    const listener = vi.fn();
    subscribeComparisonBin(listener);
    addToComparisonBin("a.csv"); // duplicate — no notify
    removeFromComparisonBin("nope.csv"); // absent — no notify
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", () => {
    const listener = vi.fn();
    const unsub = subscribeComparisonBin(listener);
    addToComparisonBin("a.csv");
    unsub();
    addToComparisonBin("b.csv");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
