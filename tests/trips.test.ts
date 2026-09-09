import { describe, expect, it } from "vitest";
import {
  addPerson, addRide, autoDescription, createTrip, deleteTrip, emptyData, isAutoDescribed,
  removePerson, removeRide, renamePerson, renameTrip, routeLabel, updateRide,
} from "../src/core/trips";
import { ValidationError } from "../src/core/types";

function tripWithPeople(...names: string[]) {
  const data = emptyData();
  const trip = createTrip(data, "Test trip");
  const people = names.map((name) => addPerson(trip, name));
  return { data, trip, people };
}

describe("autoDescription", () => {
  it("names a ride after whichever stops it has", () => {
    expect(autoDescription("Hotel", "Airport")).toBe("Hotel → Airport");
    expect(autoDescription("", "Airport")).toBe("To Airport");
    expect(autoDescription("Hotel", "")).toBe("From Hotel");
    expect(autoDescription("  ", "")).toBe("Ride");
  });
});

describe("routeLabel", () => {
  it("is empty when a ride has no stops", () => {
    expect(routeLabel({ from: "", to: "" })).toBe("");
    expect(routeLabel({ from: "Hotel", to: "Airport" })).toBe("Hotel → Airport");
  });
});

describe("trips", () => {
  it("refuses a blank or duplicate name", () => {
    const data = emptyData();
    createTrip(data, "Charleston");
    expect(() => createTrip(data, "  ")).toThrow(ValidationError);
    expect(() => createTrip(data, "charleston")).toThrow(ValidationError);
    expect(() => renameTrip(data, data.trips[0], "")).toThrow(ValidationError);
  });

  it("copies people into a new trip as separate records", () => {
    const { data, trip } = tripWithPeople("Alex", "Blair");
    const next = createTrip(data, "Austin", trip);
    expect(next.people.map((person) => person.name)).toEqual(["Alex", "Blair"]);
    expect(next.people[0].id).not.toBe(trip.people[0].id);
    expect(data.activeTripId).toBe(next.id);
  });

  it("picks a new active trip when the active one is deleted", () => {
    const data = emptyData();
    const first = createTrip(data, "One");
    createTrip(data, "Two");
    deleteTrip(data, data.trips[1]);
    expect(data.activeTripId).toBe(first.id);
    deleteTrip(data, first);
    expect(data.activeTripId).toBeNull();
    expect(data.trips).toEqual([]);
  });
});

describe("people", () => {
  it("rejects duplicates case-insensitively", () => {
    const { trip } = tripWithPeople("Alex");
    expect(() => addPerson(trip, "alex")).toThrow(ValidationError);
    expect(() => addPerson(trip, " ")).toThrow(ValidationError);
  });

  it("won't remove someone who is in a ride", () => {
    const { trip, people } = tripWithPeople("Alex", "Blair");
    addRide(trip, { description: "", from: "", to: "", amount: "10", paidBy: people[0].id, riders: [people[0].id] });
    expect(() => removePerson(trip, people[0].id)).toThrow(/in 1 ride/);
    expect(() => removePerson(trip, people[1].id)).not.toThrow();
  });

  it("renames without touching ride references", () => {
    const { trip, people } = tripWithPeople("Alex", "Blair");
    const ride = addRide(trip, {
      description: "", from: "", to: "", amount: "10", paidBy: people[0].id, riders: [people[0].id],
    });
    renamePerson(trip, people[0].id, "Alexandra");
    expect(trip.people[0].name).toBe("Alexandra");
    expect(ride.paidBy).toBe(people[0].id);
    expect(() => renamePerson(trip, people[0].id, "Blair")).toThrow(ValidationError);
  });
});

describe("rides", () => {
  it("names itself after the stops when the description is blank", () => {
    const { trip, people } = tripWithPeople("Alex", "Blair");
    const ride = addRide(trip, {
      description: "", from: "Hotel", to: "Airport", amount: "$42",
      paidBy: people[0].id, riders: people.map((person) => person.id),
    });
    expect(ride.description).toBe("Hotel → Airport");
    expect(ride.amountCents).toBe(4200);
    expect(isAutoDescribed(ride)).toBe(true);
  });

  it("keeps a description someone typed", () => {
    const { trip, people } = tripWithPeople("Alex");
    const ride = addRide(trip, {
      description: "Early flight", from: "", to: "Airport", amount: "10",
      paidBy: people[0].id, riders: [people[0].id],
    });
    expect(ride.description).toBe("Early flight");
    expect(isAutoDescribed(ride)).toBe(false);
  });

  it("validates the payer, riders and amount", () => {
    const { trip, people } = tripWithPeople("Alex");
    const base = { description: "", from: "", to: "", amount: "10", paidBy: people[0].id, riders: [people[0].id] };
    expect(() => addRide(trip, { ...base, amount: "0" })).toThrow(ValidationError);
    expect(() => addRide(trip, { ...base, paidBy: "nobody" })).toThrow(ValidationError);
    expect(() => addRide(trip, { ...base, riders: [] })).toThrow(ValidationError);
    expect(() => addRide(trip, { ...base, riders: ["ghost"] })).toThrow(ValidationError);
  });

  it("de-duplicates riders", () => {
    const { trip, people } = tripWithPeople("Alex");
    const ride = addRide(trip, {
      description: "", from: "", to: "", amount: "10",
      paidBy: people[0].id, riders: [people[0].id, people[0].id],
    });
    expect(ride.riders).toEqual([people[0].id]);
  });

  it("updates and removes rides in place", () => {
    const { trip, people } = tripWithPeople("Alex", "Blair");
    const ride = addRide(trip, {
      description: "", from: "Hotel", to: "Airport", amount: "10",
      paidBy: people[0].id, riders: [people[0].id],
    });
    updateRide(trip, ride.id, {
      description: "", from: "Hotel", to: "Beach", amount: "20",
      paidBy: people[1].id, riders: [people[1].id],
    });
    expect(trip.rides[0].description).toBe("Hotel → Beach");
    expect(trip.rides[0].amountCents).toBe(2000);
    expect(() => updateRide(trip, "gone", {
      description: "", from: "", to: "", amount: "5", paidBy: people[0].id, riders: [people[0].id],
    })).toThrow(ValidationError);
    removeRide(trip, ride.id);
    expect(trip.rides).toEqual([]);
  });
});
