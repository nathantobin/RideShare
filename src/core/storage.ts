import type { AppData, Person, Ride, Tombstones, Trip } from "./types";
import { ValidationError } from "./types";
import { emptyData, newId } from "./trips";

export const STORAGE_KEY = "rideshare.data.v5";
/** Keys trips were saved under before, newest first. Read once on load so an
 *  upgrade doesn't look like someone's trips vanished; the next save writes to
 *  STORAGE_KEY and the old key is simply left behind. */
export const LEGACY_KEYS = ["rideshare.data.v4", "rideshare.data.v3"];

/** Just enough of the Storage API to be swapped out in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadData(storage: StorageLike): AppData {
  const raw = storage.getItem(STORAGE_KEY)
    ?? LEGACY_KEYS.map((key) => storage.getItem(key)).find((value) => value != null);
  if (!raw) return emptyData();
  try {
    return parseAppData(JSON.parse(raw));
  } catch {
    // Corrupt or hand-edited storage shouldn't wedge the app on every load.
    return emptyData();
  }
}

export function saveData(storage: StorageLike, data: AppData): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function serialize(data: AppData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * One trip on its own, in the same shape as a full export so that whoever gets
 * it can import it either way - into that trip from its own page, or from the
 * dashboard as a trip they didn't have.
 *
 * The trip brings its own record of what was deleted on it, which is what stops
 * a ride you removed coming back. Deleted *trips* are left out: they're nothing
 * to do with this one.
 */
export function tripDocument(trip: Trip): AppData {
  return { version: 5, activeTripId: trip.id, trips: [trip], tombstones: {} };
}

/** Read a file the user picked with the Import button. */
export function parseImport(text: string): AppData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("That file isn't valid JSON.");
  }
  return parseAppData(parsed);
}

/** Versions we can still read. 3 predates the Uber import and 4 predates
 *  merging; both load with their records stamped as of the trip's own date, so
 *  any edit made since is the later one. */
const READABLE = new Set([3, 4, 5]);

/**
 * Turn untrusted JSON into AppData, dropping anything that doesn't hold
 * together - a ride whose payer isn't on the trip, say - rather than letting a
 * hand-edited file put the app into a state the UI can't render.
 */
function parseAppData(input: unknown): AppData {
  if (!isRecord(input) || typeof input.version !== "number" || !READABLE.has(input.version)
      || !Array.isArray(input.trips)) {
    throw new ValidationError("That file isn't Ride Share data.");
  }

  const trips = input.trips.map((raw): Trip => {
    if (!isRecord(raw)) throw new ValidationError("That file has a trip we can't read.");

    const created = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const stamp = (value: unknown) => (typeof value === "string" && value ? value : created);

    const people: Person[] = (Array.isArray(raw.people) ? raw.people : []).flatMap((person) =>
      isRecord(person) && typeof person.id === "string" && typeof person.name === "string"
        ? [{
          id: person.id,
          name: person.name,
          createdAt: stamp(person.createdAt),
          updatedAt: stamp(person.updatedAt),
        }]
        : [],
    );
    const known = new Set(people.map((person) => person.id));

    const rides: Ride[] = (Array.isArray(raw.rides) ? raw.rides : []).flatMap((ride) => {
      if (!isRecord(ride) || typeof ride.id !== "string" || typeof ride.amountCents !== "number") return [];
      if (typeof ride.paidBy !== "string" || !known.has(ride.paidBy)) return [];
      const riders = (Array.isArray(ride.riders) ? ride.riders : []).filter(
        (id): id is string => typeof id === "string" && known.has(id),
      );
      if (riders.length === 0 || ride.amountCents <= 0) return [];
      return [{
        id: ride.id,
        description: typeof ride.description === "string" ? ride.description : "Ride",
        from: typeof ride.from === "string" ? ride.from : "",
        to: typeof ride.to === "string" ? ride.to : "",
        amountCents: Math.round(ride.amountCents),
        paidBy: ride.paidBy,
        riders,
        ...(typeof ride.uberId === "string" && ride.uberId ? { uberId: ride.uberId } : {}),
        createdAt: stamp(ride.createdAt),
        updatedAt: stamp(ride.updatedAt),
      }];
    });

    return {
      id: typeof raw.id === "string" ? raw.id : newId(),
      name: typeof raw.name === "string" ? raw.name : "Imported trip",
      createdAt: created,
      updatedAt: stamp(raw.updatedAt),
      people,
      rides,
      tombstones: parseTombstones(raw.tombstones),
    };
  });

  const activeTripId = typeof input.activeTripId === "string" ? input.activeTripId : null;
  return {
    version: 5,
    trips,
    tombstones: parseTombstones(input.tombstones),
    activeTripId: trips.some((trip) => trip.id === activeTripId) ? activeTripId : (trips[0]?.id ?? null),
  };
}

/** Ids mapped to when they were deleted, dropping anything else. */
function parseTombstones(input: unknown): Tombstones {
  if (!isRecord(input)) return {};
  const tombstones: Tombstones = {};
  for (const [id, deletedAt] of Object.entries(input)) {
    if (typeof deletedAt === "string" && deletedAt) tombstones[id] = deletedAt;
  }
  return tombstones;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
