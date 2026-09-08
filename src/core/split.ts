import type { Person, Ride } from "./types";

/**
 * Split a fare evenly across riders, in whole cents.
 *
 * A fare that doesn't divide evenly leaves a few pennies over; they go to the
 * first riders in the list, so the shares always add back up to the exact fare
 * instead of drifting by a cent per ride.
 */
export function splitEvenly(cents: number, riderIds: Person["id"][]): Map<Person["id"], number> {
  const shares = new Map<Person["id"], number>();
  if (riderIds.length === 0) return shares;
  const base = Math.floor(cents / riderIds.length);
  const remainder = cents - base * riderIds.length;
  riderIds.forEach((id, index) => {
    shares.set(id, base + (index < remainder ? 1 : 0));
  });
  return shares;
}

export function rideShares(ride: Ride): Map<Person["id"], number> {
  return splitEvenly(ride.amountCents, ride.riders);
}
