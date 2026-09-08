import { describe, expect, it } from "vitest";
import { balancesFor, settleUp, tripTotalCents } from "../src/core/settle";
import type { Balance, Trip } from "../src/core/types";
import { sampleTrip } from "./fixtures";

const netOf = (balances: Balance[], id: string) =>
  balances.find((balance) => balance.personId === id)!.netCents;

describe("balancesFor", () => {
  it("matches the hand-checked numbers for a real trip", () => {
    const balances = balancesFor(sampleTrip());
    expect(tripTotalCents(sampleTrip())).toBe(27800);
    expect(netOf(balances, "alex")).toBe(4183);
    expect(netOf(balances, "blair")).toBe(350);
    expect(netOf(balances, "casey")).toBe(-3416);
    expect(netOf(balances, "drew")).toBe(-2017);
    expect(netOf(balances, "erin")).toBe(900);
  });

  it("always nets out to zero across the group", () => {
    const balances = balancesFor(sampleTrip());
    expect(balances.reduce((total, balance) => total + balance.netCents, 0)).toBe(0);
  });

  it("counts someone who paid but wasn't in the car", () => {
    const trip: Trip = {
      ...sampleTrip(),
      rides: [{ id: "r", description: "r", from: "", to: "", amountCents: 1000, paidBy: "alex", riders: ["blair"] }],
    };
    const balances = balancesFor(trip);
    expect(netOf(balances, "alex")).toBe(1000);
    expect(netOf(balances, "blair")).toBe(-1000);
  });
});

describe("settleUp", () => {
  it("produces the expected payments for the real trip", () => {
    const transfers = settleUp(balancesFor(sampleTrip()));
    expect(transfers).toEqual([
      { fromPersonId: "casey", toPersonId: "alex", amountCents: 3416 },
      { fromPersonId: "drew", toPersonId: "alex", amountCents: 767 },
      { fromPersonId: "drew", toPersonId: "erin", amountCents: 900 },
      { fromPersonId: "drew", toPersonId: "blair", amountCents: 350 },
    ]);
  });

  it("leaves everyone square, with no payments to yourself", () => {
    const balances = balancesFor(sampleTrip());
    const after = new Map(balances.map((balance) => [balance.personId, balance.netCents]));
    for (const transfer of settleUp(balances)) {
      expect(transfer.fromPersonId).not.toBe(transfer.toPersonId);
      expect(transfer.amountCents).toBeGreaterThan(0);
      after.set(transfer.fromPersonId, after.get(transfer.fromPersonId)! + transfer.amountCents);
      after.set(transfer.toPersonId, after.get(transfer.toPersonId)! - transfer.amountCents);
    }
    for (const net of after.values()) expect(net).toBe(0);
  });

  it("needs no payments when nobody owes anything", () => {
    expect(settleUp([{ personId: "a", paidCents: 500, shareCents: 500, netCents: 0 }])).toEqual([]);
  });

  it("stays under one payment per person on random trips", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const balances = randomBalances(seed);
      const transfers = settleUp(balances);
      expect(transfers.length).toBeLessThan(balances.length);
      const after = new Map(balances.map((b) => [b.personId, b.netCents]));
      for (const transfer of transfers) {
        after.set(transfer.fromPersonId, after.get(transfer.fromPersonId)! + transfer.amountCents);
        after.set(transfer.toPersonId, after.get(transfer.toPersonId)! - transfer.amountCents);
      }
      for (const net of after.values()) expect(net).toBe(0);
    }
  });
});

/** Deterministic pseudo-random balances that always sum to zero. */
function randomBalances(seed: number): Balance[] {
  let state = seed * 2654435761 + 1;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  const count = 2 + (next() % 7);
  const nets: number[] = [];
  for (let i = 0; i < count - 1; i += 1) nets.push((next() % 20000) - 10000);
  nets.push(-nets.reduce((a, b) => a + b, 0));
  return nets.map((netCents, index) => ({
    personId: `p${index}`,
    paidCents: Math.max(netCents, 0),
    shareCents: Math.max(-netCents, 0),
    netCents,
  }));
}
