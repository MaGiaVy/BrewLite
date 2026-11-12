import { describe, it, expect } from "vitest";
import { findNewPaidOrderIds } from "./kds-chime";

describe("findNewPaidOrderIds (Wave 4)", () => {
  it("flips hasLoadedOnce on empty initial load (0 PAID orders) and detects the 1st arriving PAID order", () => {
    const initialLoad = findNewPaidOrderIds(
      [{ id: 1, status: "COMPLETED" }],
      new Set<number>(),
      false
    );

    expect(initialLoad.newPaidOrderIds).toEqual([]);
    expect(initialLoad.nextHasLoadedOnce).toBe(true);
    expect(initialLoad.nextPaidIds.size).toBe(0);

    const firstPaidPoll = findNewPaidOrderIds(
      [
        { id: 1, status: "COMPLETED" },
        { id: 42, status: "PAID" },
      ],
      initialLoad.nextPaidIds,
      initialLoad.nextHasLoadedOnce
    );

    expect(firstPaidPoll.newPaidOrderIds).toEqual([42]);
    expect(firstPaidPoll.nextHasLoadedOnce).toBe(true);
    expect(firstPaidPoll.nextPaidIds.has(42)).toBe(true);

    const secondPoll = findNewPaidOrderIds(
      [
        { id: 42, status: "PAID" },
        { id: 43, status: "PAID" },
      ],
      firstPaidPoll.nextPaidIds,
      firstPaidPoll.nextHasLoadedOnce
    );

    expect(secondPoll.newPaidOrderIds).toEqual([43]);
  });

  it("does not chime for pre-existing PAID orders on initial load", () => {
    const initialLoad = findNewPaidOrderIds(
      [{ id: 10, status: "PAID" }],
      new Set<number>(),
      false
    );

    expect(initialLoad.newPaidOrderIds).toEqual([]);
    expect(initialLoad.nextHasLoadedOnce).toBe(true);
    expect(initialLoad.nextPaidIds.has(10)).toBe(true);

    const nextPoll = findNewPaidOrderIds(
      [
        { id: 10, status: "PAID" },
        { id: 11, status: "PAID" },
      ],
      initialLoad.nextPaidIds,
      initialLoad.nextHasLoadedOnce
    );

    expect(nextPoll.newPaidOrderIds).toEqual([11]);
  });
});
