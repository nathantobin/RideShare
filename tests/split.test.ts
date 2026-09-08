import { describe, expect, it } from "vitest";
import { splitEvenly } from "../src/core/split";

const sum = (shares: Map<string, number>) => [...shares.values()].reduce((a, b) => a + b, 0);

describe("splitEvenly", () => {
  it("splits a clean fare evenly", () => {
    expect([...splitEvenly(3000, ["a", "b", "c"]).values()]).toEqual([1000, 1000, 1000]);
  });

  it("gives leftover pennies to the first riders", () => {
    expect([...splitEvenly(1000, ["a", "b", "c"]).values()]).toEqual([334, 333, 333]);
    expect([...splitEvenly(4850, ["a", "b", "c", "d"]).values()]).toEqual([1213, 1213, 1212, 1212]);
  });

  it("never loses or invents a cent", () => {
    for (let cents = 1; cents <= 500; cents += 7) {
      for (let riders = 1; riders <= 9; riders += 1) {
        const ids = Array.from({ length: riders }, (_, i) => `p${i}`);
        expect(sum(splitEvenly(cents, ids))).toBe(cents);
      }
    }
  });

  it("handles a fare smaller than the number of riders", () => {
    expect([...splitEvenly(2, ["a", "b", "c"]).values()]).toEqual([1, 1, 0]);
  });

  it("returns nothing when there are no riders", () => {
    expect(splitEvenly(1000, []).size).toBe(0);
  });
});
