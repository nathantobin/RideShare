import type { Trip } from "../src/core/types";

/**
 * A real five-person trip (names changed), used as a regression fixture: these
 * totals were verified by hand before the settlement code was rewritten.
 */
export function sampleTrip(): Trip {
  const people = [
    { id: "alex", name: "Alex" },
    { id: "blair", name: "Blair" },
    { id: "casey", name: "Casey" },
    { id: "drew", name: "Drew" },
    { id: "erin", name: "Erin-Fran" },
  ];
  const all = people.map((person) => person.id);
  const ride = (id: string, amountCents: number, paidBy: string, riders: string[]) =>
    ({ id, description: id, from: "", to: "", amountCents, paidBy, riders });

  return {
    id: "trip",
    name: "Charleston",
    createdAt: "2026-06-01T00:00:00.000Z",
    people,
    rides: [
      ride("r1", 4800, "erin", all),
      ride("r2", 3000, "casey", ["alex", "drew", "blair", "casey"]),
      ride("r3", 4400, "drew", all),
      ride("r4", 5000, "blair", all),
      ride("r5", 1800, "alex", all),
      ride("r6", 3500, "alex", all),
      ride("r7", 5300, "alex", ["alex", "drew", "casey"]),
    ],
  };
}
