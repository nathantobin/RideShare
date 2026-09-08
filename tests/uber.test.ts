import { describe, expect, it } from "vitest";
import {
  importReceipts, importedIds, parseUberDocuments, parseUberReceipts, receiptToRideInput, shortAddress,
} from "../src/core/uber";
import { addPerson, createTrip, emptyData } from "../src/core/trips";
import { ValidationError } from "../src/core/types";
import type { Trip } from "../src/core/types";

/** The header Uber's "Download your data" export has used. */
const CSV_HEADER = "City,Product Type,Trip or Order Status,Request Time,Begin Trip Address,"
  + "Dropoff Address,Distance (miles),Fare Amount,Fare Currency,Trip or Order ID";

function csv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join("\n");
}

function tripWith(...names: string[]): Trip {
  const trip = createTrip(emptyData(), "Charleston");
  for (const name of names) addPerson(trip, name);
  return trip;
}

describe("the data-download CSV", () => {
  it("reads a completed ride, shortening the addresses and keeping cents exact", () => {
    const { receipts, source } = parseUberReceipts(csv(
      'Charleston,UberX,COMPLETED,2026-06-14 18:32:11 +0000 UTC,'
      + '"1455 Market St, Charleston, SC 29401","Shem\'s Creek, Mt Pleasant, SC",4.2,24.53,USD,trip-a',
    ));

    expect(source).toBe("csv");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      uberId: "trip-a",
      from: "1455 Market St",
      to: "Shem's Creek",
      amountCents: 2453,
      currency: "USD",
      product: "UberX",
    });
    expect(receipts[0].date).toMatch(/^2026-06-14/);
  });

  it("leaves out cancelled and free rides, and says why", () => {
    const { receipts, skipped } = parseUberReceipts(csv(
      "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
      "Charleston,UberX,RIDER_CANCELED,2026-06-14 19:02:00,Hotel,Bar,0,0,USD,trip-b",
      "Charleston,UberX,COMPLETED,2026-06-15 09:00:00,Hotel,Beach,1.1,0,USD,trip-c",
    ));

    expect(receipts.map((receipt) => receipt.uberId)).toEqual(["trip-a"]);
    expect(skipped.map((row) => row.reason)).toEqual(["rider canceled", "free ride"]);
    expect(skipped[0].label).toContain("Hotel → Bar");
  });

  it("matches columns by name, not position", () => {
    const { receipts } = parseUberReceipts(
      "Trip ID,Amount,Currency,Pickup Address,Destination Address\n"
      + "x1,48.50,USD,Hotel,Airport",
    );
    expect(receipts[0]).toMatchObject({ uberId: "x1", amountCents: 4850, from: "Hotel", to: "Airport" });
  });

  it("refuses a CSV with no fare column rather than importing nothing", () => {
    expect(() => parseUberReceipts("Trip ID,City,Distance\nx1,Charleston,4.2"))
      .toThrow(ValidationError);
  });
});

describe("receipt emails", () => {
  const receipt = (name: string, total: string, from: string, to: string) => [
    `Thanks for riding, ${name}`,
    `Total ${total}`,
    "Trip fare $21.53",
    "Subtotal $21.53",
    "June 14, 2026",
    `6:32 PM | ${from}`,
    `6:51 PM | ${to}`,
  ].join("\n");

  it("pulls the total, the date and the stops out of one pasted receipt", () => {
    const { receipts, source } = parseUberReceipts(
      receipt("Nathan", "$24.53", "1455 Market St, Charleston, SC", "Shem's Creek, Mt Pleasant"),
    );

    expect(source).toBe("email");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      uberId: null,
      amountCents: 2453,
      from: "1455 Market St",
      to: "Shem's Creek",
      currency: "USD",
    });
    expect(receipts[0].date).toMatch(/^2026-06-14/);
  });

  it("keeps several receipts pasted together apart", () => {
    const { receipts } = parseUberReceipts([
      receipt("Nathan", "$24.53", "Hotel", "Airport"),
      receipt("Nathan", "$18.20", "Airport", "Beach"),
    ].join("\n\n"));

    expect(receipts.map((r) => r.amountCents)).toEqual([2453, 1820]);
    expect(receipts.map((r) => r.to)).toEqual(["Airport", "Beach"]);
  });

  it("doesn't mistake the subtotal for the total", () => {
    const { receipts } = parseUberReceipts("Thanks for riding, Nathan\nSubtotal $21.53\nTotal $24.53");
    expect(receipts[0].amountCents).toBe(2453);
  });

  it("notes a euro receipt as euros instead of quietly calling it dollars", () => {
    const { receipts } = parseUberReceipts("Thanks for riding, Nathan\nTotal €38.00");
    expect(receipts[0]).toMatchObject({ amountCents: 3800, currency: "EUR" });
  });

  it("reads one that still has its html on, as a saved .eml does", () => {
    const { receipts } = parseUberReceipts([
      "<html><head><style>td { color: red }</style></head><body>",
      "<p>Thanks for riding, Nathan</p>",
      "<table><tr><td>Total</td><td>&#36;24.53</td></tr>",
      "<tr><td>Subtotal</td><td>$21.53</td></tr></table>",
      "<p>June&nbsp;14, 2026</p>",
      "<div>6:32 PM | Shem&#39;s Creek, Mt Pleasant</div>",
      "<div>6:51 PM | Hotel, Charleston</div>",
      "</body></html>",
    ].join(""));

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amountCents: 2453, from: "Shem's Creek", to: "Hotel" });
    expect(receipts[0].date).toMatch(/^2026-06-14/);
  });

  it("reads the two-column layout a pdf receipt comes back as", () => {
    // Exactly what src/ui/pdf.ts produces for an Uber receipt PDF: no pipe
    // between the time and the address, just the columns run together.
    const { receipts } = parseUberReceipts([
      "Uber",
      "Thanks for riding, Nathan",
      "Total $24.53",
      "Trip fare $21.53",
      "Subtotal $21.53",
      "Booking Fee $3.00",
      "June 14, 2026",
      "6:32 PM 1455 Market St, Charleston, SC 29401",
      "6:51 PM Shem's Creek, Mt Pleasant, SC",
    ].join("\n"));

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      amountCents: 2453, from: "1455 Market St", to: "Shem's Creek",
    });
    expect(receipts[0].date).toMatch(/^2026-06-14/);
  });

  it("reports text it can't make sense of", () => {
    expect(() => parseUberReceipts("   ")).toThrow(ValidationError);
    expect(() => parseUberReceipts("a grocery list\nmilk\neggs")).toThrow(ValidationError);
  });
});

describe("turning receipts into rides", () => {
  it("logs each one to the payer, split among the riders", () => {
    const trip = tripWith("Alex", "Blair", "Casey");
    const [alex, blair] = trip.people;
    const { receipts } = parseUberReceipts(csv(
      "Charleston,UberX,COMPLETED,2026-06-15 09:00:00,Hotel,Beach,1.1,30,USD,trip-b",
      "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
    ));

    const rides = importReceipts(trip, receipts, alex.id, [alex.id, blair.id]);

    expect(rides).toHaveLength(2);
    expect(trip.rides).toHaveLength(2);
    expect(rides.map((ride) => ride.amountCents)).toEqual([2453, 3000]);
    expect(rides[0]).toMatchObject({
      description: "Hotel → Airport", paidBy: alex.id, riders: [alex.id, blair.id], uberId: "trip-a",
    });
  });

  it("names a ride with no stops after its date", () => {
    const trip = tripWith("Alex");
    const { receipts } = parseUberReceipts("Thanks for riding, Nathan\nTotal $24.53\nJune 14, 2026");
    const [ride] = importReceipts(trip, receipts, trip.people[0].id, [trip.people[0].id]);
    expect(ride.description).toMatch(/^Uber · /);
  });

  it("adds nothing when the riders or the payer are wrong", () => {
    const trip = tripWith("Alex");
    const { receipts } = parseUberReceipts(csv(
      "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
    ));

    expect(() => importReceipts(trip, receipts, trip.people[0].id, [])).toThrow(ValidationError);
    expect(() => importReceipts(trip, receipts, "nobody", [trip.people[0].id])).toThrow(ValidationError);
    expect(() => importReceipts(trip, [], trip.people[0].id, [trip.people[0].id])).toThrow(ValidationError);
    expect(trip.rides).toEqual([]);
  });

  it("knows which uber trips are already logged, so a second upload can skip them", () => {
    const trip = tripWith("Alex");
    const { receipts } = parseUberReceipts(csv(
      "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
    ));
    expect(importedIds(trip).size).toBe(0);

    importReceipts(trip, receipts, trip.people[0].id, [trip.people[0].id]);
    expect(importedIds(trip)).toEqual(new Set(["trip-a"]));
  });

  it("hands the ride form an amount it can parse back", () => {
    const { receipts } = parseUberReceipts(csv(
      "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,1234.5,USD,trip-a",
    ));
    expect(receiptToRideInput(receipts[0], "alex", ["alex"]).amount).toBe("1234.50");
  });
});

describe("shortAddress", () => {
  it("keeps the street and drops the city, state and zip", () => {
    expect(shortAddress("1455 Market St, Charleston, SC 29401")).toBe("1455 Market St");
    expect(shortAddress("Charleston Airport")).toBe("Charleston Airport");
    expect(shortAddress("  ")).toBe("");
  });
});

describe("several files at once", () => {
  const emailed = (total: string, from: string, to: string, day: string) => [
    "Thanks for riding, Nathan",
    `Total ${total}`,
    `June ${day}, 2026`,
    `6:32 PM | ${from}`,
    `6:51 PM | ${to}`,
  ].join("\n");

  it("merges a stack of receipt pdfs into one list, oldest first", () => {
    const { receipts } = parseUberDocuments([
      { name: "receipt-2.pdf", text: emailed("$18.20", "Airport", "Beach", "16") },
      { name: "receipt-1.pdf", text: emailed("$24.53", "Hotel", "Airport", "14") },
    ]);

    expect(receipts.map((receipt) => receipt.amountCents)).toEqual([2453, 1820]);
    expect(receipts.map((receipt) => receipt.to)).toEqual(["Airport", "Beach"]);
  });

  it("keeps the readable files when one of them is a dud", () => {
    const { receipts, skipped } = parseUberDocuments([
      { name: "receipt.pdf", text: emailed("$24.53", "Hotel", "Airport", "14") },
      { name: "boarding-pass.pdf", text: "Seat 14C\nGate B12" },
      { name: "scanned.pdf", text: "   " },
    ]);

    expect(receipts).toHaveLength(1);
    expect(skipped.map((row) => row.label)).toEqual(["boarding-pass.pdf", "scanned.pdf"]);
    expect(skipped[0].reason).toContain("doesn't look like");
    expect(skipped[1].reason).toContain("no text");
  });

  it("logs a trip once when its pdf and the csv both turn up", () => {
    const { receipts } = parseUberDocuments([
      { name: "trips_data.csv", text: csv(
        "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
        "Charleston,UberX,COMPLETED,2026-06-15 09:00:00,Hotel,Beach,1.1,18.00,USD,trip-c",
      ) },
      { name: "trip-a.csv", text: csv(
        "Charleston,UberX,COMPLETED,2026-06-14 18:32:11,Hotel,Airport,4.2,24.53,USD,trip-a",
      ) },
    ]);

    expect(receipts.map((receipt) => receipt.uberId)).toEqual(["trip-a", "trip-c"]);
  });

  it("explains a single unreadable file in its own words", () => {
    expect(() => parseUberDocuments([{ name: "boarding-pass.pdf", text: "Seat 14C" }]))
      .toThrow(/doesn't look like an Uber receipt/);
    expect(() => parseUberDocuments([{ name: "scan.pdf", text: "" }]))
      .toThrow(/no text in that file/i);
  });

  it("says how many failed when none of them worked", () => {
    expect(() => parseUberDocuments([
      { name: "a.pdf", text: "Seat 14C" },
      { name: "b.pdf", text: "" },
    ])).toThrow(/None of those 2 files/);
  });
});
