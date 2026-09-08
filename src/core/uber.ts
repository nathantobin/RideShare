import { addRide, requirePerson, type RideInput } from "./trips";
import type { Ride, Trip } from "./types";
import { ValidationError } from "./types";

/**
 * One ride read out of an Uber receipt, before anyone has said who was in the
 * car. Everything here is what the receipt claimed; nothing is trusted enough
 * to skip the review table.
 */
export interface UberReceipt {
  /** Uber's own trip id, when the export carries one, so a second upload of the
   *  same file can tell which rides are already in. Receipt emails rarely have
   *  it, hence null. */
  uberId: string | null;
  /** ISO timestamp, or "" when the receipt didn't say. */
  date: string;
  from: string;
  to: string;
  amountCents: number;
  /** "USD". Kept because the app formats everything as dollars and that is
   *  worth warning about rather than quietly mislabelling a €38 fare. */
  currency: string;
  /** "UberX", when the export says. */
  product: string;
}

/** A row we understood well enough to leave out, and why. */
export interface SkippedRow {
  label: string;
  reason: string;
}

export interface UberImport {
  receipts: UberReceipt[];
  skipped: SkippedRow[];
  /** Which shape the text turned out to be, so the UI can say so. */
  source: "csv" | "email";
}

/**
 * Read either shape of Uber receipt data:
 *
 * - the `trips_data.csv` from Uber's "Download your data" export, which is the
 *   whole history but takes a day or two to arrive; and
 * - the text of the receipt emails, which is what you actually have on the
 *   Monday after the trip.
 *
 * Uber changes both formats without warning, so the CSV is matched on column
 * names rather than positions and the email parser is frankly a best effort —
 * everything it produces goes in front of the user before it becomes a ride.
 */
export function parseUberReceipts(text: string): UberImport {
  const trimmed = text.trim();
  if (!trimmed) throw new ValidationError("There's nothing to import.");
  return looksLikeCsv(trimmed) ? parseCsvExport(trimmed) : parseReceiptEmails(trimmed);
}

/** Turn a reviewed receipt into the same input shape the ride form submits. */
export function receiptToRideInput(
  receipt: UberReceipt,
  paidBy: string,
  riders: string[],
): RideInput {
  return {
    description: describeReceipt(receipt),
    from: receipt.from,
    to: receipt.to,
    amount: (receipt.amountCents / 100).toFixed(2),
    paidBy,
    riders,
    ...(receipt.uberId ? { uberId: receipt.uberId } : {}),
  };
}

/** "Market St → Airport", or "Uber · Jun 14" when the receipt had no stops. */
export function describeReceipt(receipt: UberReceipt): string {
  if (receipt.from || receipt.to) return "";
  const day = formatReceiptDate(receipt.date);
  return day ? `Uber · ${day}` : "Uber";
}

/** "Jun 14" for the review table and for naming a ride with no stops. */
export function formatReceiptDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One uploaded or pasted file, named so a dud can be pointed at. */
export interface UberDocument {
  name: string;
  text: string;
}

/**
 * Read several files as one import.
 *
 * A PDF receipt is a single ride, so a weekend means half a dozen of them;
 * these are parsed separately and merged rather than glued into one string,
 * which keeps one unreadable file from taking the others down with it. A trip
 * that arrives twice - its own PDF and a row in the CSV - is kept once.
 */
export function parseUberDocuments(documents: UberDocument[]): UberImport {
  const receipts: UberReceipt[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  // Kept whole as well as lowercased: as a reason it reads "receipt.pdf - no
  // text in it", but on its own it should still be a proper sentence.
  const failures: string[] = [];
  let anyCsv = false;

  for (const document of documents) {
    if (!document.text.trim()) {
      const message = "There's no text in that file - a scan or a photo, rather than a receipt?";
      skipped.push({ label: document.name, reason: uncapitalise(message) });
      failures.push(message);
      continue;
    }
    let parsed: UberImport;
    try {
      parsed = parseUberReceipts(document.text);
    } catch (problem) {
      const message = problem instanceof ValidationError ? problem.message : "That file couldn't be read.";
      skipped.push({ label: document.name, reason: uncapitalise(message) });
      failures.push(message);
      continue;
    }

    anyCsv ||= parsed.source === "csv";
    skipped.push(...parsed.skipped);
    for (const receipt of parsed.receipts) {
      if (receipt.uberId) {
        if (seen.has(receipt.uberId)) continue;
        seen.add(receipt.uberId);
      }
      receipts.push(receipt);
    }
  }

  // Nothing usable at all is worth an error rather than an empty review table;
  // with one file its own reason is the clearest thing we can say.
  if (receipts.length === 0) {
    throw new ValidationError(
      failures.length === 1
        ? failures[0]
        : `None of those ${documents.length} files had a readable Uber receipt.`,
    );
  }

  return { receipts: inOrder(receipts), skipped, source: anyCsv ? "csv" : "email" };
}

/** "No text in that file." -> "no text in that file", to sit after a dash. */
function uncapitalise(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, "");
}

// --- Uber's data-download CSV ------------------------------------------------

/** Column names Uber has used, normalised, best match first. */
const COLUMNS = {
  uberId: ["tripororderid", "triporderid", "tripid", "orderid", "requestid", "id"],
  date: ["requesttime", "begintriptime", "requestdatetime", "date", "time"],
  from: ["begintripaddress", "pickupaddress", "beginaddress", "origin", "from"],
  to: ["dropoffaddress", "destinationaddress", "dropoff", "destination", "to"],
  amount: ["fareamount", "totalfare", "fare", "amount", "total"],
  currency: ["farecurrency", "currency"],
  status: ["tripororderstatus", "triporderstatus", "tripstatus", "orderstatus", "status"],
  product: ["producttype", "product", "vehicletype"],
  city: ["city"],
} as const;

/** A status that means the ride happened and someone was charged for it. */
const COMPLETED = /^(completed|fulfilled|finished)$/;

/**
 * A header row with several columns, at least one of which we recognise. The
 * fare column deliberately isn't required here: a CSV without one is still a
 * CSV, and saying so beats trying to read it as a receipt email.
 */
function looksLikeCsv(text: string): boolean {
  const header = normaliseHeaders(parseCsvRows(text.slice(0, 4000))[0] ?? []);
  if (header.length < 3) return false;
  return Object.values(COLUMNS).some((candidates) => pick(header, candidates) >= 0);
}

function parseCsvExport(text: string): UberImport {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim()));
  const header = normaliseHeaders(rows[0] ?? []);
  const at = {
    uberId: pick(header, COLUMNS.uberId),
    date: pick(header, COLUMNS.date),
    from: pick(header, COLUMNS.from),
    to: pick(header, COLUMNS.to),
    amount: pick(header, COLUMNS.amount),
    currency: pick(header, COLUMNS.currency),
    status: pick(header, COLUMNS.status),
    product: pick(header, COLUMNS.product),
    city: pick(header, COLUMNS.city),
  };
  if (at.amount < 0) {
    throw new ValidationError("That CSV has no fare column - is it Uber's trips_data.csv?");
  }

  const receipts: UberReceipt[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of rows.slice(1)) {
    const cell = (index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
    const status = cell(at.status);
    const label = rowLabel(cell(at.date), cell(at.from), cell(at.to), cell(at.city));

    if (status && !COMPLETED.test(status.toLowerCase().replace(/[^a-z]/g, ""))) {
      skipped.push({ label, reason: status.toLowerCase().replace(/_/g, " ") });
      continue;
    }
    const amountCents = readAmount(cell(at.amount));
    if (amountCents === null) {
      skipped.push({ label, reason: "no fare on the row" });
      continue;
    }
    if (amountCents <= 0) {
      skipped.push({ label, reason: "free ride" });
      continue;
    }

    receipts.push({
      uberId: cell(at.uberId) || null,
      date: readDate(cell(at.date)),
      from: shortAddress(cell(at.from)),
      to: shortAddress(cell(at.to)),
      amountCents,
      currency: (cell(at.currency) || "USD").toUpperCase(),
      product: cell(at.product),
    });
  }

  return { receipts: inOrder(receipts), skipped, source: "csv" };
}

function rowLabel(date: string, from: string, to: string, city: string): string {
  const route = [shortAddress(from), shortAddress(to)].filter(Boolean).join(" → ");
  return [formatReceiptDate(readDate(date)) || date, route || city].filter(Boolean).join(" · ") || "a row";
}

/** Oldest first, so imported rides land in the order they were taken. Receipts
 *  with no date keep their place at the end rather than jumping to the top. */
function inOrder(receipts: UberReceipt[]): UberReceipt[] {
  return [...receipts].sort((a, b) => {
    if (!a.date || !b.date) return (a.date ? 0 : 1) - (b.date ? 0 : 1);
    return a.date.localeCompare(b.date);
  });
}

/** RFC 4180 enough for addresses with commas in them. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function normaliseHeaders(header: string[]): string[] {
  return header.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/** Index of the first candidate column present, or -1. */
function pick(header: string[], candidates: readonly string[]): number {
  for (const candidate of candidates) {
    const index = header.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

// --- Receipt emails ----------------------------------------------------------

/** The greeting each receipt email opens with, used to tell two of them apart. */
const RECEIPT_START = /^.*(?:thanks for (?:riding|tipping|using)|here'?s your (?:trip )?receipt)/gim;
/** Fallback boundary for a receipt pasted without its greeting. */
const TOTAL_START = /(?:^|\n)[^\n\S]*total[^\n$€£]*[$€£]/gi;
/**
 * "Total $24.53", but not "Subtotal" and not the tip or the trip fare lines.
 * The amount is allowed onto the next line because an HTML receipt puts the
 * label and the figure in neighbouring table cells, which strip to two lines.
 */
const TOTAL = /(?:^|\n)[^\n\S]*total[^\n$€£]*\n?[^\n\S]*[$€£]\s*([\d,]+(?:\.\d{2})?)/i;
/** A line that opens with a time, and whatever it has after it. */
const STOP = /^(\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?)\s*(?:([|·–—-])\s*)?(.*)$/i;
const EMAIL_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/i;

function parseReceiptEmails(raw: string): UberImport {
  const text = stripMarkup(raw);
  const receipts: UberReceipt[] = [];
  const skipped: SkippedRow[] = [];

  for (const chunk of splitReceipts(text)) {
    const total = TOTAL.exec(chunk);
    const amountCents = total ? readAmount(total[1]) : null;
    if (amountCents === null || amountCents <= 0) {
      skipped.push({ label: firstLine(chunk), reason: "couldn't find a total" });
      continue;
    }
    const stops = findStops(chunk);
    const date = EMAIL_DATE.exec(chunk);
    receipts.push({
      uberId: null,
      date: date ? readDate(date[0]) : "",
      from: shortAddress(stops[0] ?? ""),
      to: shortAddress(stops.length > 1 ? stops[stops.length - 1] : ""),
      amountCents,
      currency: currencyOf(total?.[0] ?? ""),
      product: "",
    });
  }

  // Nothing at all came out, so this wasn't receipts - as opposed to a CSV of
  // real rides that happened to be all cancelled, which is worth reporting.
  if (receipts.length === 0) {
    throw new ValidationError("That doesn't look like an Uber receipt or trips_data.csv.");
  }
  return { receipts: inOrder(receipts), skipped, source: "email" };
}

/**
 * Uber's receipts are HTML mail, so a saved .eml or a copy that brought its
 * markup along arrives full of tags. Turning each tag into a line break gets it
 * back to roughly the shape the rest of this file expects; plain text passes
 * through untouched.
 */
function stripMarkup(text: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(text)) return text;
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", pound: "£", euro: "€",
};

/** Left as-is when it isn't one we know, which reads better than "&hellip;". */
function decodeEntity(whole: string, body: string): string {
  const named = NAMED_ENTITIES[body.toLowerCase()];
  if (named) return named;
  const hex = /^#x([0-9a-f]+)$/i.exec(body);
  if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
  const decimal = /^#(\d+)$/.exec(body);
  return decimal ? String.fromCodePoint(Number(decimal[1])) : whole;
}

/**
 * The stops on a receipt, in the order they were passed.
 *
 * Receipts write these three ways, so this works line by line rather than with
 * one regex over the whole text:
 *
 *     9:41 PM | 1455 Market St, San Francisco    an email, with a separator
 *     9:41 PM   1455 Market St, San Francisco    two columns of a PDF
 *     9:41 PM                                    a PDF that stacks them, which
 *     1455 Market St, San Francisco              is what Uber's own receipts do
 *
 * Only the first of those actually says "this is a stop". For the other two the
 * address has to look like one, because plenty of lines on a receipt start with
 * a time - the header above "Thanks for tipping" is a time and then the word
 * "Tip", which is how a ride once got logged as "Tip -> 715 Ralston Ct".
 */
function findStops(chunk: string): string[] {
  const lines = chunk.split("\n").map((line) => line.trim());
  const stops: string[] = [];

  lines.forEach((line, index) => {
    const match = STOP.exec(line);
    if (!match) return;
    const [, , separator, rest] = match;
    if (rest) {
      if (separator || looksLikeAddress(rest)) stops.push(rest);
      return;
    }
    // Nothing after the time, so the address is the line underneath - if what's
    // underneath is an address at all.
    const below = lines[index + 1] ?? "";
    if (looksLikeAddress(below)) stops.push(below);
  });

  return stops;
}

/**
 * Enough of an address to be worth trusting without a separator saying so.
 * Uber writes them as "715 Ralston Ct, Mount Pleasant, SC", so a comma or a
 * house number is the evidence; a bare word like "Tip" is not an address, and
 * a line with money on it is a fare breakdown row.
 */
function looksLikeAddress(text: string): boolean {
  if (!text || /[$€£]/.test(text)) return false;
  return text.includes(",") || /^\d+\s+\S/.test(text);
}

/**
 * One chunk per receipt, so several pasted together still come out separately.
 * Splitting on the greeting keeps each receipt's total with its own stops;
 * only when there is no greeting to split on do we fall back to the totals.
 */
function splitReceipts(text: string): string[] {
  const greetings = boundaries(text, RECEIPT_START);
  const starts = greetings.length > 0 ? greetings : boundaries(text, TOTAL_START);
  if (starts.length <= 1) return [text];
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length));
}

function boundaries(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => match.index ?? 0);
}

function firstLine(chunk: string): string {
  return chunk.trim().split("\n")[0]?.slice(0, 60).trim() || "a receipt";
}

function currencyOf(matched: string): string {
  if (matched.includes("€")) return "EUR";
  if (matched.includes("£")) return "GBP";
  return "USD";
}

// --- Shared field readers ----------------------------------------------------

/** "$1,234.56" or "1234.56" to whole cents; null when it isn't a number. */
function readAmount(raw: string): number | null {
  const text = raw.trim().replace(/[$€£,\s]/g, "");
  if (!text || !/^-?\d*\.?\d*$/.test(text) || text === "." || text === "-") return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * Uber writes times as "2026-06-14 18:32:11 +0000 UTC", which Date won't take.
 * Returns an ISO string, or "" rather than an Invalid Date the UI has to guard.
 */
function readDate(raw: string): string {
  const text = raw.trim().replace(/\s+UTC$/i, "").replace(/\s+\+0000$/, "");
  if (!text) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2})?)/.exec(text);
  const date = new Date(iso ? `${iso[1]}T${iso[2]}` : text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * "1455 Market St, San Francisco, CA 94103" -> "1455 Market St". The full
 * address is too long to read in a ride list and the street is the bit anyone
 * recognises.
 */
export function shortAddress(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const first = text.split(",")[0].trim();
  return first || text;
}

// --- Turning receipts into rides ---------------------------------------------

/** Uber trip ids already logged on this trip, so a second upload can say so. */
export function importedIds(trip: Trip): Set<string> {
  return new Set(trip.rides.flatMap((ride) => (ride.uberId ? [ride.uberId] : [])));
}

/**
 * Log the chosen receipts as rides, all paid by the same person - they are one
 * Uber account's receipts, so one person put them all on their card - and split
 * among the same riders. Who was actually in which car varies, so the rides are
 * edited afterwards like any other.
 *
 * The payer and riders are checked before anything is added, so a bad choice
 * fails cleanly instead of half way down the list.
 */
export function importReceipts(
  trip: Trip,
  receipts: UberReceipt[],
  paidBy: string,
  riders: string[],
): Ride[] {
  if (receipts.length === 0) throw new ValidationError("Pick at least one receipt to import.");
  requirePerson(trip, paidBy);
  const unique = riders.filter((id, index) => riders.indexOf(id) === index);
  if (unique.length === 0) throw new ValidationError("Pick at least one person who was in the car.");
  for (const riderId of unique) requirePerson(trip, riderId);

  return receipts.map((receipt) => addRide(trip, receiptToRideInput(receipt, paidBy, unique)));
}
