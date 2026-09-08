import { useRef, useState } from "preact/hooks";
import { formatMoney } from "../core/money";
import {
  formatReceiptDate, importedIds, importReceipts, parseUberDocuments,
  type UberDocument, type UberImport as ParsedReceipts, type UberReceipt,
} from "../core/uber";
import type { Trip } from "../core/types";
import { ValidationError } from "../core/types";
import { readTextFile } from "./dom";
import { commit, showError } from "./store";

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * pdf.js dwarfs the rest of the app, so it's fetched the first time someone
 * picks a PDF and never at all for anyone who doesn't.
 */
async function readPdf(file: File): Promise<string> {
  const { readPdfText } = await import("./pdf");
  return readPdfText(file);
}

function routeOf(receipt: UberReceipt): string {
  const stops = [receipt.from, receipt.to].filter(Boolean);
  return stops.length === 2 ? stops.join(" → ") : (stops[0] ?? "");
}

/**
 * Read Uber receipts and turn the ones you pick into rides.
 *
 * There is no "connect your Uber account" behind this on purpose: see the note
 * in the README. Uber's trip-history API doesn't return fares, which is the one
 * thing a fare splitter needs, so the receipts themselves are the only place
 * the number actually exists.
 */
export function UberImport({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [parsed, setParsed] = useState<ParsedReceipts | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [paidBy, setPaidBy] = useState(trip.people[0]?.id ?? "");
  const [riders, setRiders] = useState<Set<string>>(new Set(trip.people.map((person) => person.id)));
  const fileInput = useRef<HTMLInputElement>(null);

  const done = importedIds(trip);
  const receipts = parsed?.receipts ?? [];
  const keyOf = (receipt: UberReceipt, index: number) => receipt.uberId ?? `row-${index}`;

  const read = (documents: UberDocument[]) => {
    try {
      const result = parseUberDocuments(documents);
      const already = importedIds(trip);
      setParsed(result);
      // Anything already logged starts unticked, so a second upload of the same
      // export adds only what's new.
      setChosen(new Set(result.receipts.map(keyOf).filter((key) => !already.has(key))));
      showError(null);
    } catch (problem) {
      showError(problem instanceof ValidationError ? problem.message : "Couldn't read that file.");
    }
  };

  const readFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;

    setReading(true);
    try {
      read(await Promise.all(files.map(async (file) => ({
        name: file.name,
        text: isPdf(file) ? await readPdf(file) : await readTextFile(file),
      }))));
    } catch {
      showError("Couldn't read that file.");
    } finally {
      setReading(false);
    }
  };

  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChosen(next);
  };

  const toggleRider = (personId: string) => {
    const next = new Set(riders);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    setRiders(next);
  };

  const picked = receipts.filter((receipt, index) => chosen.has(keyOf(receipt, index)));

  const save = () => {
    const added = commit(() => importReceipts(trip, picked, paidBy || trip.people[0]?.id || "", [...riders]));
    if (added) onDone();
  };

  if (!parsed) {
    return (
      <div class="uber">
        <p class="uber-lead">
          Upload your reciepts directly from Uber or paste them in. Ride Share will read the fares and let you split them with your friends.
        </p>
        <ol class="uber-how">
          <li>
            <strong>One trip's worth:</strong> open each Uber receipt email, select all,
            and paste below. Several at once is fine.
          </li>
          <li>
            <strong>One trip's worth:</strong> Download each email from uber as a pdf, then upload them here.
          </li>
          <li>
            <strong>Everything at once:</strong> ask Uber for your data at{" "}
            <a href="https://myprivacy.uber.com/privacy/exploreyourdata/download" target="_blank" rel="noreferrer">
              Uber's privacy centre
            </a>{" "}
            and upload the <code>trips_data.csv</code> it emails you a day or two later.
          </li>
        </ol>

        <div class="actions">
          <button disabled={reading} onClick={() => fileInput.current?.click()}>
            {reading ? "Reading…" : "Choose files…"}
          </button>
          <input ref={fileInput} type="file" hidden multiple
                 accept=".pdf,.csv,.txt,.eml,application/pdf,text/csv,text/plain"
                 onChange={readFiles} />
          <button class="ghost" onClick={onDone}>Cancel</button>
        </div>

        <label for="uber-text">Or paste the receipts</label>
        <textarea id="uber-text" rows={5} placeholder="Thanks for riding, Nathan&#10;Total $24.53&#10;…"
                  value={text} onInput={(event) => setText(event.currentTarget.value)} />
        <div class="actions">
          <button class="primary" disabled={!text.trim() || reading}
                  onClick={() => read([{ name: "the pasted text", text }])}>
            Read receipts
          </button>
        </div>
      </div>
    );
  }

  const foreign = receipts.filter((receipt) => receipt.currency !== "USD");

  return (
    <div class="uber">
      <p class="uber-lead">
        Found {receipts.length} ride{receipts.length === 1 ? "" : "s"} in{" "}
        {parsed.source === "csv" ? "that export" : "those receipts"}. Untick anything that
        wasn't part of {trip.name}.
      </p>

      {receipts.length === 0
        ? <p class="empty">Nothing here looked like a completed ride.</p>
        : (
          <div class="uber-rows">
            {receipts.map((receipt, index) => {
              const key = keyOf(receipt, index);
              const already = receipt.uberId != null && done.has(receipt.uberId);
              return (
                <label key={key} class={chosen.has(key) ? "uber-row on" : "uber-row"}>
                  <input type="checkbox" checked={chosen.has(key)} onChange={() => toggle(key)} />
                  <span class="meta">
                    <span class="desc">{routeOf(receipt) || "Uber ride"}</span>
                    <span class="sub">
                      {[formatReceiptDate(receipt.date), receipt.product].filter(Boolean).join(" · ")}
                      {already && <> · <em>already imported</em></>}
                    </span>
                  </span>
                  <span class="amt money">{formatMoney(receipt.amountCents)}</span>
                </label>
              );
            })}
          </div>
        )}

      {parsed.skipped.length > 0 && (
        <details class="uber-skipped">
          <summary>{parsed.skipped.length} left out</summary>
          <ul>
            {parsed.skipped.map((row, index) => (
              <li key={index}>{row.label} — {row.reason}</li>
            ))}
          </ul>
        </details>
      )}

      {foreign.length > 0 && (
        <p class="hint">
          {foreign.length} of these are in {[...new Set(foreign.map((r) => r.currency))].join(" and ")}.
          Ride Share shows every amount as dollars, so the figures are right but the sign isn't.
        </p>
      )}

      <label for="uber-payer">Whose Uber account is this?</label>
      <select id="uber-payer" value={paidBy} onChange={(event) => setPaidBy(event.currentTarget.value)}>
        {trip.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>

      <label>Who was in the car?</label>
      <div class="chips">
        {trip.people.map((person) => (
          <label key={person.id} class={riders.has(person.id) ? "chip on" : "chip"}>
            <input type="checkbox" checked={riders.has(person.id)} onChange={() => toggleRider(person.id)} />
            {person.name}
          </label>
        ))}
      </div>
      <p class="hint">
        Every imported ride gets these riders. Where that's wrong — the two of you who
        went back early — fix that ride with <strong>edit</strong> once it's in.
      </p>

      <div class="actions">
        <button class="primary" disabled={picked.length === 0 || riders.size === 0} onClick={save}>
          Add {picked.length} ride{picked.length === 1 ? "" : "s"}
        </button>
        <button onClick={() => { setParsed(null); setText(""); }}>Back</button>
        <button class="ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
