import type { AppData, Person, Ride, Trip } from "./types";
import { ValidationError } from "./types";
import { emptyData, newId } from "./trips";

export const STORAGE_KEY = "rideshare.data.v4";
/** Keys trips were saved under before, newest first. Read once on load so an
 *  upgrade doesn't look like someone's trips vanished; the next save writes to
 *  STORAGE_KEY and the old key is simply left behind. */
export const LEGACY_KEYS = ["rideshare.data.v3"];

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

/** Versions we can still read. 3 predates the Uber import, and a v3 file
 *  loads as a v4 one with no ride linked to a receipt. */
const READABLE = new Set([3, 4]);

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

    const people: Person[] = (Array.isArray(raw.people) ? raw.people : []).flatMap((person) =>
      isRecord(person) && typeof person.id === "string" && typeof person.name === "string"
        ? [{ id: person.id, name: person.name }]
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
        description: typeof ride.description === "string" ? ride.description : "Taxi",
        from: typeof ride.from === "string" ? ride.from : "",
        to: typeof ride.to === "string" ? ride.to : "",
        amountCents: Math.round(ride.amountCents),
        paidBy: ride.paidBy,
        riders,
        ...(typeof ride.uberId === "string" && ride.uberId ? { uberId: ride.uberId } : {}),
      }];
    });

    return {
      id: typeof raw.id === "string" ? raw.id : newId(),
      name: typeof raw.name === "string" ? raw.name : "Imported trip",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
      people,
      rides,
    };
  });

  const activeTripId = typeof input.activeTripId === "string" ? input.activeTripId : null;
  return {
    version: 4,
    trips,
    activeTripId: trips.some((trip) => trip.id === activeTripId) ? activeTripId : (trips[0]?.id ?? null),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
