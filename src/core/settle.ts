import { rideShares } from "./split";
import type { Balance, Person, Transfer, Trip } from "./types";

/** What each person paid out, what their rides actually cost them, and the net. */
export function balancesFor(trip: Trip): Balance[] {
  const paid = new Map<Person["id"], number>();
  const share = new Map<Person["id"], number>();
  for (const person of trip.people) {
    paid.set(person.id, 0);
    share.set(person.id, 0);
  }
  for (const ride of trip.rides) {
    paid.set(ride.paidBy, (paid.get(ride.paidBy) ?? 0) + ride.amountCents);
    for (const [personId, amount] of rideShares(ride)) {
      share.set(personId, (share.get(personId) ?? 0) + amount);
    }
  }
  return trip.people.map((person) => {
    const paidCents = paid.get(person.id) ?? 0;
    const shareCents = share.get(person.id) ?? 0;
    return { personId: person.id, paidCents, shareCents, netCents: paidCents - shareCents };
  });
}

/**
 * Payments that zero every balance.
 *
 * Repeatedly matches the biggest debtor to the biggest creditor. That isn't
 * guaranteed to be the theoretical minimum number of payments (which is
 * NP-hard), but it never exceeds one payment per person and in practice lands
 * on the obvious answer: four Venmos for a five-person trip, not ten.
 */
export function settleUp(balances: Balance[]): Transfer[] {
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ id: b.personId, amount: -b.netCents }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ id: b.personId, amount: b.netCents }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ fromPersonId: debtors[i].id, toPersonId: creditors[j].id, amountCents: amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }
  return transfers;
}

export function tripTotalCents(trip: Trip): number {
  return trip.rides.reduce((sum, ride) => sum + ride.amountCents, 0);
}
