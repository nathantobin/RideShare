/** A person who shared at least one fare on a trip. */
export interface Person {
  id: string;
  name: string;
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
}

export interface Trip {
  id: string;
  name: string;
  createdAt: string;
  people: Person[];
  rides: Ride[];
}

export interface AppData {
  version: 4;
  activeTripId: Trip["id"] | null;
  trips: Trip[];
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
