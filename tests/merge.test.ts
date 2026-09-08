import { describe, expect, it } from "vitest";
import { mergeData, mergeTripFrom, mergeTrips, summariseMerge } from "../src/core/merge";
import { balancesFor, tripTotalCents } from "../src/core/settle";
import {
  addPerson, addRide, createTrip, deleteTrip, emptyData, removePerson, removeRide, renameTrip,
  updateRide,
} from "../src/core/trips";
import { ValidationError } from "../src/core/types";
import type { AppData, Trip } from "../src/core/types";
import { serialize, tripDocument, parseImport } from "../src/core/storage";

/**
 * Two phones with the same trip on them.
 *
 * Everything is deep-copied, so what happens on one is invisible to the other
 * until they're merged - which is the whole point of the exercise.
 */
function twoCopies(): { alex: AppData; blair: AppData } {
  const data = emptyData();
  const trip = createTrip(data, "Charleston");
  for (const name of ["Alex", "Blair", "Casey"]) addPerson(trip, name);
  return { alex: clone(data), blair: clone(data) };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function only(data: AppData): Trip {
  return data.trips[0];
}

function personId(trip: Trip, name: string): string {
  return trip.people.find((person) => person.name === name)!.id;
}

/** Log a ride, and make sure its stamp is distinguishable from its neighbours. */
function log(trip: Trip, description: string, amount: string, at: string) {
  const payer = trip.people[0].id;
  const ride = addRide(trip, {
    description, from: "", to: "", amount, paidBy: payer,
    riders: trip.people.map((person) => person.id),
  });
  ride.createdAt = at;
  ride.updatedAt = at;
  return ride;
}

describe("merging two copies of a trip", () => {
  it("keeps the rides both people logged", () => {
    const { alex, blair } = twoCopies();
    log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");

    const merged = mergeTrips(only(alex), only(blair));

    expect(merged.rides.map((ride) => ride.description)).toEqual(["Airport run", "Dinner"]);
    expect(tripTotalCents(merged)).toBe(7200);
  });

  it("gives the same answer whichever way round it's done", () => {
    const { alex, blair } = twoCopies();
    log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");
    renameTrip(blair, only(blair), "Charleston, June");

    expect(mergeTrips(only(alex), only(blair))).toEqual(mergeTrips(only(blair), only(alex)));
  });

  it("is unchanged by merging a copy of itself", () => {
    const { alex } = twoCopies();
    log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    expect(mergeTrips(only(alex), clone(only(alex)))).toEqual(only(alex));
    expect(mergeData(alex, clone(alex))).toEqual(alex);
  });

  it("takes the later edit when both changed the same ride", () => {
    const { alex } = twoCopies();
    const ride = log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    const theirs = clone(alex);

    updateRide(only(alex), ride.id, {
      description: "Airport", from: "", to: "", amount: "35",
      paidBy: only(alex).people[0].id, riders: [only(alex).people[0].id],
    });
    only(alex).rides[0].updatedAt = "2026-06-15T09:00:00.000Z";

    updateRide(only(theirs), ride.id, {
      description: "Airport, with the toll", from: "", to: "", amount: "38",
      paidBy: only(theirs).people[0].id, riders: [only(theirs).people[0].id],
    });
    only(theirs).rides[0].updatedAt = "2026-06-15T11:00:00.000Z";

    const merged = mergeTrips(only(alex), only(theirs));
    expect(merged.rides).toHaveLength(1);
    expect(merged.rides[0]).toMatchObject({ amountCents: 3800, description: "Airport, with the toll" });
  });

  it("keeps a ride deleted even when the other side edited it afterwards", () => {
    const { alex } = twoCopies();
    const ride = log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    const blair = clone(alex);

    removeRide(only(alex), ride.id);
    only(blair).rides[0].updatedAt = "2099-01-01T00:00:00.000Z";

    const merged = mergeTrips(only(alex), only(blair));
    expect(merged.rides).toEqual([]);
    expect(merged.tombstones[ride.id]).toBeTruthy();
  });

  it("takes the later name for the trip", () => {
    const { alex, blair } = twoCopies();
    only(alex).updatedAt = "2026-06-14T10:00:00.000Z";
    renameTrip(blair, only(blair), "Charleston, June");
    only(blair).updatedAt = "2026-06-14T12:00:00.000Z";

    expect(mergeTrips(only(alex), only(blair)).name).toBe("Charleston, June");
  });

  it("brings back a rider one side deleted and the other put in a ride", () => {
    const { alex, blair } = twoCopies();
    const casey = personId(only(alex), "Casey");

    // Alex drops Casey, who as far as Alex knows was never in a car.
    removePerson(only(alex), casey);
    // Blair, meanwhile, logs a ride that Casey was in.
    log(only(blair), "Beach", "24", "2026-06-14T10:00:00.000Z");

    const merged = mergeTrips(only(alex), only(blair));

    expect(merged.people.map((person) => person.name)).toContain("Casey");
    expect(merged.tombstones[casey]).toBeUndefined();
    // And the trip still adds up: everyone's share is accounted for.
    expect(balancesFor(merged).reduce((sum, balance) => sum + balance.netCents, 0)).toBe(0);
  });

  it("leaves a deleted rider deleted when nobody used them", () => {
    const { alex, blair } = twoCopies();
    const casey = personId(only(alex), "Casey");
    removePerson(only(alex), casey);

    const merged = mergeTrips(only(alex), only(blair));
    expect(merged.people.map((person) => person.name)).toEqual(["Alex", "Blair"]);
  });
});

describe("merging whole files", () => {
  it("adds trips you don't have and merges the ones you do", () => {
    const { alex, blair } = twoCopies();
    log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");
    createTrip(blair, "Austin");

    const merged = mergeData(alex, blair);

    expect(merged.trips.map((trip) => trip.name)).toEqual(["Charleston", "Austin"]);
    expect(only(merged).rides).toHaveLength(2);
  });

  it("doesn't resurrect a trip you deleted", () => {
    const { alex, blair } = twoCopies();
    deleteTrip(alex, only(alex));

    const merged = mergeData(alex, blair);
    expect(merged.trips).toEqual([]);
  });

  it("keeps you on the trip you were looking at", () => {
    const { alex, blair } = twoCopies();
    const austin = createTrip(blair, "Austin");
    expect(blair.activeTripId).toBe(austin.id);

    expect(mergeData(alex, blair).activeTripId).toBe(alex.activeTripId);
  });

  it("counts what an import actually brought in", () => {
    const { alex, blair } = twoCopies();
    log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");
    createTrip(blair, "Austin");

    expect(summariseMerge(alex, mergeData(alex, blair))).toEqual({ trips: 1, rides: 1 });
    expect(summariseMerge(alex, mergeData(alex, clone(alex)))).toEqual({ trips: 0, rides: 0 });
  });
});

describe("one trip out of a file", () => {
  it("takes that trip's rides and leaves the others alone", () => {
    const { alex, blair } = twoCopies();
    const austin = createTrip(alex, "Austin");
    log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");
    createTrip(blair, "Somewhere else");

    const merged = mergeTripFrom(alex, blair, only(alex).id);

    expect(only(merged).rides.map((ride) => ride.description)).toEqual(["Dinner"]);
    // The file's other trip didn't come along, and mine is untouched.
    expect(merged.trips.map((trip) => trip.name)).toEqual(["Charleston", "Austin"]);
    expect(merged.trips[1].id).toBe(austin.id);
  });

  it("says so when the file hasn't got this trip in it", () => {
    const { alex } = twoCopies();
    const other = emptyData();
    createTrip(other, "Austin");

    expect(() => mergeTripFrom(alex, other, only(alex).id)).toThrow(ValidationError);
    expect(() => mergeTripFrom(alex, other, only(alex).id)).toThrow(/import from All trips/);
  });

  it("changes nothing when the file hasn't got it", () => {
    const { alex } = twoCopies();
    const before = JSON.stringify(alex);
    try {
      mergeTripFrom(alex, emptyData(), only(alex).id);
    } catch {
      // expected
    }
    expect(JSON.stringify(alex)).toBe(before);
  });
});

describe("exporting one trip", () => {
  it("round-trips through the importer", () => {
    const { alex } = twoCopies();
    log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");

    const reread = parseImport(serialize(tripDocument(only(alex))));

    expect(reread.trips).toHaveLength(1);
    expect(reread.trips[0]).toEqual(only(alex));
  });

  it("carries the trip's own deletions but not other trips'", () => {
    const { alex } = twoCopies();
    const ride = log(only(alex), "Airport run", "30", "2026-06-14T10:00:00.000Z");
    const austin = createTrip(alex, "Austin");
    removeRide(only(alex), ride.id);
    deleteTrip(alex, austin);

    const document = tripDocument(only(alex));

    expect(document.trips[0].tombstones[ride.id]).toBeTruthy();
    expect(document.tombstones).toEqual({});
  });

  it("is enough on its own to stop a deleted ride coming back", () => {
    const { alex, blair } = twoCopies();
    const ride = log(only(blair), "Dinner", "42", "2026-06-14T20:00:00.000Z");
    // Alex takes Blair's trip, then deletes the ride and sends it back.
    const withRide = mergeTripFrom(alex, blair, only(alex).id);
    removeRide(only(withRide), ride.id);

    const returned = mergeTripFrom(blair, parseImport(serialize(tripDocument(only(withRide)))), only(blair).id);
    expect(only(returned).rides).toEqual([]);
  });
});
