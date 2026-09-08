// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { loadData, saveData, type StorageLike } from "../src/core/storage";
import { addPerson, addRide, createTrip, emptyData } from "../src/core/trips";
import type { AppData } from "../src/core/types";
import { App } from "../src/ui/App";
import { initStore } from "../src/ui/store";

class FakeStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

/** Alex pays a $30 fare shared three ways. */
function seeded(): AppData {
  const data = emptyData();
  const trip = createTrip(data, "Charleston");
  const [alex, blair, casey] = ["Alex", "Blair", "Casey"].map((name) => addPerson(trip, name));
  addRide(trip, {
    description: "", from: "Airport", to: "Hotel", amount: "30",
    paidBy: alex.id, riders: [alex.id, blair.id, casey.id],
  });
  return data;
}

let container: HTMLElement;

/**
 * Render the app over a fresh storage. Returns a reader for what's actually
 * been saved - the store loads its own copy, so the seed object passed in is
 * not the one the app mutates.
 */
function mount(data: AppData, hash = "#/"): () => AppData {
  const storage = new FakeStorage();
  saveData(storage, data);
  window.location.hash = hash;
  initStore(storage);
  container = document.createElement("div");
  document.body.append(container);
  act(() => { render(<App />, container); });
  return () => loadData(storage);
}

function click(text: string): void {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`No button labelled "${text}"`);
  act(() => { button.click(); });
}

function type(selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  input.value = value;
  act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("dashboard", () => {
  it("lists trips with their totals and what's left to settle", () => {
    mount(seeded());
    const card = container.querySelector(".trip-card")!;
    expect(card.textContent).toContain("Charleston");
    expect(card.textContent).toContain("3 riders");
    expect(card.textContent).toContain("$30.00");
    expect(card.textContent).toContain("2 payments to settle");
  });

  it("invites you to make one when there are none", () => {
    mount(emptyData());
    expect(container.querySelector(".trip-card")).toBeNull();
    expect(container.querySelector(".empty-state")?.textContent).toContain("No trips yet");
  });

  it("opens the trip it just created", () => {
    mount(emptyData());
    type("#trip-name", "Austin");
    click("Create");
    expect(window.location.hash).toMatch(/^#\/trip\//);
  });
});

describe("trip page", () => {
  it("shows the settlement for the trip in the url", () => {
    const data = seeded();
    mount(data, `#/trip/${data.trips[0].id}`);
    const text = container.textContent ?? "";
    expect(text).toContain("Charleston");
    expect(text).toContain("Airport → Hotel");
    expect(text).toContain("Blair pays Alex");
    expect(text).toContain("$10.00");
  });

  it("falls back to the dashboard for a trip that isn't there", () => {
    mount(seeded(), "#/trip/missing");
    expect(window.location.hash).toBe("#/");
  });

  it("adds a ride from the form, names it after the stops, and saves it", () => {
    const data = seeded();
    const saved = mount(data, `#/trip/${data.trips[0].id}`);
    type("#ride-from", "Beach");
    type("#ride-amount", "12");
    click("Add ride");

    const rides = saved().trips[0].rides;
    expect(rides).toHaveLength(2);
    expect(rides[1].description).toBe("From Beach");
    expect(rides[1].amountCents).toBe(1200);
    expect(container.textContent).toContain("$42.00");
  });

  it("clears the form after a ride is added", () => {
    const data = seeded();
    mount(data, `#/trip/${data.trips[0].id}`);
    type("#ride-from", "Beach");
    type("#ride-amount", "12");
    click("Add ride");
    expect(container.querySelector<HTMLInputElement>("#ride-from")?.value).toBe("");
    expect(container.querySelector<HTMLInputElement>("#ride-amount")?.value).toBe("");
  });

  it("reports a bad fare instead of saving it", () => {
    const data = seeded();
    const saved = mount(data, `#/trip/${data.trips[0].id}`);
    type("#ride-amount", "twelve");
    click("Add ride");
    expect(saved().trips[0].rides).toHaveLength(1);
    expect(container.querySelector(".err")?.textContent).toContain("isn't a number");
  });
});

describe("importing uber receipts", () => {
  const CSV = [
    "City,Product Type,Trip or Order Status,Request Time,Begin Trip Address,Dropoff Address,Fare Amount,Fare Currency,Trip or Order ID",
    "Charleston,UberX,COMPLETED,2026-06-14 18:32:11 +0000 UTC,\"1455 Market St, Charleston, SC\",Airport,24.53,USD,trip-a",
    "Charleston,UberX,CANCELED,2026-06-14 19:02:00 +0000 UTC,Hotel,Bar,0,USD,trip-b",
    "Charleston,UberX,COMPLETED,2026-06-15 09:00:00 +0000 UTC,Hotel,Beach,18.00,USD,trip-c",
  ].join("\n");

  /** Open a seeded trip and paste the export into the importer. */
  function paste(text: string, data = seeded()): () => AppData {
    const saved = mount(data, `#/trip/${data.trips[0].id}`);
    click("Import from Uber");
    type("#uber-text", text);
    click("Read receipts");
    return saved;
  }

  it("lists what it found, oldest first, and says what it left out", () => {
    paste(CSV);
    const rows = [...container.querySelectorAll(".uber-row")];
    expect(rows.map((row) => row.querySelector(".desc")?.textContent))
      .toEqual(["1455 Market St → Airport", "Hotel → Beach"]);
    expect(rows[0].textContent).toContain("$24.53");
    expect(container.querySelector(".uber-skipped")?.textContent).toContain("1 left out");
  });

  it("logs the ticked receipts as rides paid by one person", () => {
    const saved = paste(CSV);
    click("Add 2 rides");

    const trip = saved().trips[0];
    expect(trip.rides).toHaveLength(3); // the seeded ride, plus two imported
    const imported = trip.rides.slice(1);
    expect(imported.map((ride) => ride.amountCents)).toEqual([2453, 1800]);
    expect(imported.map((ride) => ride.uberId)).toEqual(["trip-a", "trip-c"]);
    expect(imported.every((ride) => ride.paidBy === trip.people[0].id)).toBe(true);
    expect(container.textContent).toContain("$72.53");
  });

  it("unticks rides from a second upload of the same export", () => {
    const data = seeded();
    paste(CSV, data);
    click("Add 2 rides");
    click("Import from Uber");
    type("#uber-text", CSV);
    click("Read receipts");

    expect(container.textContent).toContain("already imported");
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Add "));
    expect(add?.textContent).toBe("Add 0 rides");
    expect(add?.disabled).toBe(true);
  });

  it("reads a pasted receipt email too", () => {
    const saved = paste([
      "Thanks for riding, Nathan",
      "Total $32.10",
      "June 14, 2026",
      "6:32 PM | Hotel, Charleston",
      "6:51 PM | Airport, Charleston",
    ].join("\n"));

    click("Add 1 ride");
    expect(saved().trips[0].rides[1]).toMatchObject({ amountCents: 3210, from: "Hotel", to: "Airport" });
  });

  it("says so when the text isn't receipts, and adds nothing", () => {
    const saved = paste("a grocery list\nmilk\neggs");
    expect(container.querySelector(".err")?.textContent).toContain("doesn't look like");
    expect(saved().trips[0].rides).toHaveLength(1);
  });
});
