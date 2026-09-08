import type { AppData, Person, Ride, Tombstones, Trip } from "./types";
import { ValidationError } from "./types";

/**
 * Folding two copies of the same data back together.
 *
 * Everything here is pure and works on whole documents, so it's the same
 * function whether the other copy arrived in a file someone sent you or off a
 * server later on. The rules, in one place:
 *
 * - Records are matched by id. One that only one side has is kept.
 * - Two copies of the same record: the later updatedAt wins, whole. Nobody
 *   edits half a ride, so there's nothing to gain from merging field by field.
 * - A deletion beats an edit however new the edit is. Someone deleted the thing
 *   on purpose, and quietly bringing it back because another phone touched it
 *   afterwards is the worse surprise.
 * - Unless the deletion has been overtaken: a rider deleted on one phone and
 *   put in a ride on another comes back, because a fare split among someone who
 *   isn't on the trip doesn't add up.
 *
 * Merging is commutative - merging theirs into mine and mine into theirs give
 * the same answer - which is what lets two people sync in whichever order they
 * happen to open the app.
 */
export function mergeData(mine: AppData, theirs: AppData): AppData {
  const tombstones = mergeTombstones(mine.tombstones, theirs.tombstones);
  const trips = mergeById(mine.trips, theirs.trips, tombstones, mergeTrips).sort(byCreation);

  return {
    version: 5,
    trips,
    tombstones,
    // Which trip was open is about this browser, not about the data, so a file
    // off someone else's phone doesn't move you off the page you're looking at.
    activeTripId: trips.some((trip) => trip.id === mine.activeTripId)
      ? mine.activeTripId
      : (trips[0]?.id ?? null),
  };
}

export function mergeTrips(mine: Trip, theirs: Trip): Trip {
  const tombstones = mergeTombstones(mine.tombstones, theirs.tombstones);
  const rides = mergeById(mine.rides, theirs.rides, tombstones, later).sort(byCreation);
  const people = mergeById(mine.people, theirs.people, tombstones, later);

  // A rider deleted on one side but left in a surviving ride on the other has
  // to come back: removePerson would never have allowed the deletion while that
  // ride existed, and balancesFor only counts people who are on the trip, so a
  // ride missing a rider would leave the trip impossible to settle.
  const needed = new Set(rides.flatMap((ride) => [ride.paidBy, ...ride.riders]));
  for (const person of [...mine.people, ...theirs.people]) {
    if (!needed.has(person.id) || people.some((kept) => kept.id === person.id)) continue;
    delete tombstones[person.id];
    people.push(person);
  }

  const newer = later(mine, theirs);
  return {
    id: mine.id,
    name: newer.name,
    updatedAt: newer.updatedAt,
    // The earlier of the two, which is whenever the trip was really started.
    createdAt: mine.createdAt <= theirs.createdAt ? mine.createdAt : theirs.createdAt,
    people: people.sort(byCreation),
    rides,
    tombstones,
  };
}

/**
 * Fold one trip out of a file into the copy already here, leaving every other
 * trip in both alone.
 *
 * This is what importing from a trip's own page does: you're looking at
 * Charleston and someone has sent you their Charleston, so that's the only
 * thing that should change. A file that doesn't have this trip in it is a
 * mistake worth naming rather than a no-op.
 */
export function mergeTripFrom(mine: AppData, incoming: AppData, tripId: Trip["id"]): AppData {
  const theirs = incoming.trips.find((trip) => trip.id === tripId);
  if (!theirs) {
    throw new ValidationError(
      "That file doesn't have this trip in it. To add it as a new trip, import from All trips.",
    );
  }
  return {
    ...mine,
    trips: mine.trips.map((trip) => (trip.id === tripId ? mergeTrips(trip, theirs) : trip)),
  };
}

/** What a merge brought in, for telling the user what just happened. */
export function summariseMerge(before: AppData, after: AppData): { trips: number; rides: number } {
  const hadTrip = new Set(before.trips.map((trip) => trip.id));
  const hadRide = new Set(before.trips.flatMap((trip) => trip.rides.map((ride) => ride.id)));
  return {
    trips: after.trips.filter((trip) => !hadTrip.has(trip.id)).length,
    rides: after.trips.flatMap((trip) => trip.rides).filter((ride) => !hadRide.has(ride.id)).length,
  };
}

/** The three fields every mergeable record carries. */
interface Stamped {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Union two lists by id, dropping what's been deleted since. */
function mergeById<T extends Stamped>(
  mine: T[],
  theirs: T[],
  tombstones: Tombstones,
  combine: (a: T, b: T) => T,
): T[] {
  const merged = new Map<string, T>();
  for (const record of [...mine, ...theirs]) {
    if (tombstones[record.id]) continue;
    const seen = merged.get(record.id);
    merged.set(record.id, seen ? combine(seen, record) : record);
  }
  return [...merged.values()];
}

/**
 * The later of two versions of a record.
 *
 * Two phones can stamp the same millisecond, and a merge that answered
 * differently depending on which copy it was handed first would be no use, so
 * an exact tie falls back to comparing the contents: arbitrary, but the same
 * arbitrary answer on both phones.
 */
function later<T extends Stamped>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return fingerprint(a) >= fingerprint(b) ? a : b;
}

function fingerprint(record: Stamped): string {
  const fields = record as Partial<Ride & Person & Trip>;
  return [
    fields.name ?? "", fields.description ?? "", fields.amountCents ?? "",
    fields.from ?? "", fields.to ?? "", fields.paidBy ?? "", (fields.riders ?? []).join(","),
  ].join(" ");
}

/** Earliest delete wins, so both sides agree on when it happened. */
function mergeTombstones(mine: Tombstones, theirs: Tombstones): Tombstones {
  const merged: Tombstones = { ...mine };
  for (const [id, deletedAt] of Object.entries(theirs)) {
    if (!merged[id] || deletedAt < merged[id]) merged[id] = deletedAt;
  }
  return merged;
}

function byCreation(a: Stamped, b: Stamped): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
