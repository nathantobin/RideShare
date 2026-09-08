/**
 * When each deleted record was deleted, by id.
 *
 * A deletion has to outlive the thing it deleted. Without that, merging in a
 * copy made before the delete would quietly bring the record back, and there
 * would be no way to tell "Blair deleted this" from "Blair hasn't seen it yet".
 *
 * Kept out of `people` and `rides` on purpose: those arrays go on meaning
 * "what's actually on this trip", so settling up and the views never have to
 * know that any of this exists.
 */
export type Tombstones = Record<string, string>;

/** A person who shared at least one fare on a trip. */
export interface Person {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One taxi ride, paid by one person and split evenly among its riders. */
export interface Ride {
  id: string;
  /** What to call it. Derived from the stops when the user leaves it blank. */
  description: string;
  from: string;
  to: string;
  /** Whole cents, so nothing drifts. */
  amountCents: number;
  paidBy: Person["id"];
  riders: Person["id"][];
  /** Uber's trip id, set when the ride came from an imported receipt, so
   *  uploading the same export twice doesn't log every ride again. */
  uberId?: string;
  createdAt: string;
  /** Last edit, so merging two copies of a ride can pick the later one. */
  updatedAt: string;
}

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  /** When the name was last changed; the name is the only field of its own. */
  updatedAt: string;
  people: Person[];
  rides: Ride[];
  /** Riders and rides removed from this trip. */
  tombstones: Tombstones;
}

export interface AppData {
  version: 5;
  /** Which trip this browser had open. Never merged - it's about the device. */
  activeTripId: Trip["id"] | null;
  trips: Trip[];
  /** Trips that were deleted. */
  tombstones: Tombstones;
}

/** What one person paid, what they should have paid, and the difference. */
export interface Balance {
  personId: Person["id"];
  paidCents: number;
  shareCents: number;
  /** Positive = they are owed money. */
  netCents: number;
}

/** One payment that moves the group closer to settled. */
export interface Transfer {
  fromPersonId: Person["id"];
  toPersonId: Person["id"];
  amountCents: number;
}

/** A problem worth showing the user, as opposed to a bug. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
