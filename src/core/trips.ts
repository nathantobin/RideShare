import type { AppData, Person, Ride, Trip } from "./types";
import { ValidationError } from "./types";
import { parseAmount } from "./money";

export function newId(): string {
  return crypto.randomUUID();
}

let lastStamp = 0;

/**
 * The clock every record is stamped with, which never repeats itself.
 *
 * Date.now() only has milliseconds, and adding three riders takes rather less
 * than one, so a plain clock hands them all the same stamp - and a merge, with
 * no way to order them, would shuffle the riders on the trip into some other
 * order on the way through. Stepping forward a millisecond when the clock
 * hasn't moved keeps every record on this device distinct and in order.
 *
 * Two phones still won't agree to the millisecond, so a merge can call the
 * "later" of two genuinely simultaneous edits wrong. That takes two people
 * editing the same ride in the same moment to notice, and the merge still lands
 * on one answer rather than losing both.
 */
export function now(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export function emptyData(): AppData {
  return { version: 5, activeTripId: null, trips: [], tombstones: {} };
}

/** Name a ride after its stops when the description is left blank. */
export function autoDescription(from: string, to: string): string {
  const a = from.trim();
  const b = to.trim();
  if (a && b) return `${a} → ${b}`;
  if (b) return `To ${b}`;
  if (a) return `From ${a}`;
  return "Taxi";
}

/** "Hotel → Airport" for display under the title, or "" if the ride has no stops. */
export function routeLabel(ride: Pick<Ride, "from" | "to">): string {
  return ride.from.trim() || ride.to.trim() ? autoDescription(ride.from, ride.to) : "";
}

/** True when a description looks auto-generated, so it can re-derive from new stops. */
export function isAutoDescribed(ride: Pick<Ride, "description" | "from" | "to">): boolean {
  return ride.description === autoDescription(ride.from, ride.to);
}

export function createTrip(data: AppData, name: string, copyPeopleFrom?: Trip | null): Trip {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Give the trip a name.");
  if (data.trips.some((trip) => trip.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new ValidationError(`There's already a trip called "${trimmed}".`);
  }
  const stamp = now();
  const trip: Trip = {
    id: newId(),
    name: trimmed,
    createdAt: stamp,
    updatedAt: stamp,
    // Stamped one at a time, so copied riders keep the order they were in.
    people: (copyPeopleFrom?.people ?? []).map((person) => {
      const at = now();
      return { id: newId(), name: person.name, createdAt: at, updatedAt: at };
    }),
    rides: [],
    tombstones: {},
  };
  data.trips.push(trip);
  data.activeTripId = trip.id;
  return trip;
}

export function renameTrip(data: AppData, trip: Trip, name: string): Trip {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("A trip needs a name.");
  if (data.trips.some((other) => other !== trip && other.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new ValidationError(`There's already a trip called "${trimmed}".`);
  }
  trip.name = trimmed;
  trip.updatedAt = now();
  return trip;
}

/**
 * Drop a trip, leaving only the fact that it was dropped.
 *
 * The trip's contents go for good - names, rides, and the addresses an Uber
 * import put in them - so "this can't be undone" stays true. What's kept is one
 * timestamp against the id, which is what stops a merge putting it all back.
 */
export function deleteTrip(data: AppData, trip: Trip): void {
  data.trips = data.trips.filter((other) => other.id !== trip.id);
  data.tombstones[trip.id] = now();
  if (data.activeTripId === trip.id) {
    data.activeTripId = data.trips[0]?.id ?? null;
  }
}

export function addPerson(trip: Trip, name: string): Person {
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("A person needs a name.");
  if (trip.people.some((person) => person.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new ValidationError(`${trimmed} is already on this trip.`);
  }
  const stamp = now();
  const person: Person = { id: newId(), name: trimmed, createdAt: stamp, updatedAt: stamp };
  trip.people.push(person);
  return person;
}

export function renamePerson(trip: Trip, personId: string, name: string): Person {
  const person = requirePerson(trip, personId);
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("A person needs a name.");
  if (trip.people.some((other) => other.id !== personId && other.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new ValidationError(`${trimmed} is already on this trip.`);
  }
  person.name = trimmed;
  person.updatedAt = now();
  return person;
}

export function removePerson(trip: Trip, personId: string): Person {
  const person = requirePerson(trip, personId);
  const used = trip.rides.filter((ride) => ride.paidBy === personId || ride.riders.includes(personId));
  if (used.length > 0) {
    throw new ValidationError(
      `${person.name} is in ${used.length} ride${used.length === 1 ? "" : "s"} on this trip - remove those first.`,
    );
  }
  trip.people = trip.people.filter((other) => other.id !== personId);
  trip.tombstones[personId] = now();
  return person;
}

export function requirePerson(trip: Trip, personId: string): Person {
  const person = trip.people.find((other) => other.id === personId);
  if (!person) throw new ValidationError("That person isn't on this trip.");
  return person;
}

export function personName(trip: Trip, personId: string): string {
  return trip.people.find((person) => person.id === personId)?.name ?? "(removed)";
}

export interface RideInput {
  description: string;
  from: string;
  to: string;
  amount: string | number;
  paidBy: string;
  riders: string[];
  /** Only set by the Uber import; the ride form leaves it alone. */
  uberId?: string;
}

/** The fields the form supplies; the caller stamps the timestamps. */
function buildRide(trip: Trip, input: RideInput): Omit<Ride, "id" | "createdAt" | "updatedAt"> {
  const amountCents = parseAmount(input.amount);
  if (trip.people.length === 0) throw new ValidationError("Add some people to the trip first.");
  requirePerson(trip, input.paidBy);
  const riders = input.riders.filter((id, index) => input.riders.indexOf(id) === index);
  if (riders.length === 0) throw new ValidationError("Pick at least one person who was in the car.");
  for (const riderId of riders) requirePerson(trip, riderId);

  const from = input.from.trim();
  const to = input.to.trim();
  return {
    description: input.description.trim() || autoDescription(from, to),
    from,
    to,
    amountCents,
    paidBy: input.paidBy,
    riders,
    // Left off entirely when absent, so editing an imported ride through the
    // form keeps the link to its receipt instead of clearing it.
    ...(input.uberId ? { uberId: input.uberId } : {}),
  };
}

export function addRide(trip: Trip, input: RideInput): Ride {
  const stamp = now();
  const ride: Ride = { id: newId(), ...buildRide(trip, input), createdAt: stamp, updatedAt: stamp };
  trip.rides.push(ride);
  return ride;
}

export function updateRide(trip: Trip, rideId: string, input: RideInput): Ride {
  const ride = trip.rides.find((other) => other.id === rideId);
  if (!ride) throw new ValidationError("That ride is no longer on this trip.");
  Object.assign(ride, buildRide(trip, input), { updatedAt: now() });
  return ride;
}

export function removeRide(trip: Trip, rideId: string): void {
  trip.rides = trip.rides.filter((ride) => ride.id !== rideId);
  trip.tombstones[rideId] = now();
}
