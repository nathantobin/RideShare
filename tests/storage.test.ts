import { beforeEach, describe, expect, it } from "vitest";
import { loadData, parseImport, saveData, serialize, STORAGE_KEY, type StorageLike } from "../src/core/storage";
import { tripTotalCents } from "../src/core/settle";
import { addPerson, addRide, createTrip, emptyData } from "../src/core/trips";
import { ValidationError } from "../src/core/types";

class FakeStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

let storage: FakeStorage;
beforeEach(() => { storage = new FakeStorage(); });

describe("loadData", () => {
  it("starts empty and survives corrupt storage", () => {
    expect(loadData(storage).trips).toEqual([]);
    storage.setItem(STORAGE_KEY, "{not json");
    expect(loadData(storage).trips).toEqual([]);
    storage.setItem(STORAGE_KEY, JSON.stringify({ nonsense: true }));
    expect(loadData(storage).trips).toEqual([]);
  });

  it("round-trips what it saved", () => {
    const data = emptyData();
    const trip = createTrip(data, "Charleston");
    const alex = addPerson(trip, "Alex");
    const blair = addPerson(trip, "Blair");
    addRide(trip, { description: "", from: "Hotel", to: "Airport", amount: "48.50", paidBy: alex.id, riders: [alex.id, blair.id] });
    saveData(storage, data);

    const loaded = loadData(storage);
    expect(loaded).toEqual(data);
    expect(tripTotalCents(loaded.trips[0])).toBe(4850);
  });
});

describe("parseImport", () => {
  it("re-imports its own export", () => {
    const data = emptyData();
    const trip = createTrip(data, "Charleston");
    const alex = addPerson(trip, "Alex");
    addRide(trip, { description: "Solo", from: "", to: "", amount: "12", paidBy: alex.id, riders: [alex.id] });
    expect(parseImport(serialize(data))).toEqual(data);
  });

  it("drops rides that reference people who aren't on the trip", () => {
    const broken = JSON.stringify({
      version: 3,
      activeTripId: "t",
      trips: [{
        id: "t", name: "Broken", createdAt: "2026-01-01T00:00:00.000Z",
        people: [{ id: "a", name: "Alex" }],
        rides: [
          { id: "r1", description: "ok", from: "", to: "", amountCents: 100, paidBy: "a", riders: ["a"] },
          { id: "r2", description: "bad payer", from: "", to: "", amountCents: 100, paidBy: "ghost", riders: ["a"] },
          { id: "r3", description: "no riders", from: "", to: "", amountCents: 100, paidBy: "a", riders: ["ghost"] },
        ],
      }],
    });
    expect(parseImport(broken).trips[0].rides.map((ride) => ride.id)).toEqual(["r1"]);
  });

  it("keeps several trips and the active one", () => {
    const data = emptyData();
    createTrip(data, "Charleston");
    const austin = createTrip(data, "Austin");
    const imported = parseImport(serialize(data));
    expect(imported.trips.map((trip) => trip.name)).toEqual(["Charleston", "Austin"]);
    expect(imported.activeTripId).toBe(austin.id);
  });

  it("falls back to the first trip when the active one is missing", () => {
    const data = emptyData();
    const first = createTrip(data, "Charleston");
    data.activeTripId = "gone";
    expect(parseImport(serialize(data)).activeTripId).toBe(first.id);
  });

  it("rejects files that aren't this app's data", () => {
    expect(() => parseImport("not json")).toThrow(ValidationError);
    expect(() => parseImport(JSON.stringify({ hello: "world" }))).toThrow(ValidationError);
    expect(() => parseImport(JSON.stringify({ version: 2, trips: [] }))).toThrow(ValidationError);
  });
});
