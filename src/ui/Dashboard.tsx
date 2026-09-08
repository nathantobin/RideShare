import { useState } from "preact/hooks";
import { formatMoney } from "../core/money";
import { balancesFor, settleUp, tripTotalCents } from "../core/settle";
import { serialize } from "../core/storage";
import { createTrip, deleteTrip, renameTrip } from "../core/trips";
import type { Trip } from "../core/types";
import { navigate } from "./App";
import { DataBar, describeMerge } from "./DataBar";
import { commit, mergeIntoData, useAppData } from "./store";

function statusOf(trip: Trip): string {
  if (trip.rides.length === 0) return "No rides yet";
  const transfers = settleUp(balancesFor(trip));
  if (transfers.length === 0) return "Everyone's square";
  return `${transfers.length} payment${transfers.length === 1 ? "" : "s"} to settle`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function Dashboard({ trips }: { trips: Trip[] }) {
  const [name, setName] = useState("");

  const create = () => {
    const created = commit((data) => createTrip(data, name));
    if (created) {
      setName("");
      navigate({ name: "trip", tripId: created.id });
    }
  };

  // Newest first, which is the trip you're most likely still adding to.
  const ordered = [...trips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div class="page-head">
        <h1>Your trips</h1>
      </div>

      <div class="card new-trip">
        <label for="trip-name">Start a trip</label>
        <div class="row">
          <input
            id="trip-name"
            type="text"
            placeholder="Charleston, June 2026"
            autocomplete="off"
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") create(); }}
          />
          <button class="primary" onClick={create}>Create</button>
        </div>
      </div>

      {ordered.length > 0
        ? <ul class="trip-list">{ordered.map((trip) => <TripCard key={trip.id} trip={trip} />)}</ul>
        : (
          <p class="empty-state">
            No trips yet. Name your first one above — a weekend, a city, whatever you'll
            recognise later — then add the people and the rides.
          </p>
        )}

      <AllTripsBar />
    </>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const rename = () => {
    const next = window.prompt(`Rename "${trip.name}" to:`, trip.name);
    if (next !== null) commit((data) => renameTrip(data, trip, next));
  };

  const remove = () => {
    const detail = trip.rides.length === 0 ? "" : ` and its ${count(trip.rides.length, "ride")}`;
    if (!window.confirm(`Delete "${trip.name}"${detail}? This can't be undone.`)) return;
    commit((data) => deleteTrip(data, trip));
  };

  return (
    <li class="trip-card">
      <a class="trip-open" href={`#/trip/${encodeURIComponent(trip.id)}`}>
        <span class="trip-name">{trip.name}</span>
        <span class="trip-meta">
          {count(trip.people.length, "rider")} · {count(trip.rides.length, "ride")} ·{" "}
          <span class="money">{formatMoney(tripTotalCents(trip))}</span>
        </span>
        <span class="trip-status">{statusOf(trip)}</span>
      </a>
      <div class="trip-card-actions">
        <span class="trip-date">{formatDate(trip.createdAt)}</span>
        <button class="ghost" onClick={rename}>Rename</button>
        <button class="ghost danger" onClick={remove}>Delete</button>
      </div>
    </li>
  );
}

/** Everything in this browser, for backing up or handing to someone. */
function AllTripsBar() {
  const data = useAppData();
  return (
    <DataBar
      hint="Saved in this browser. Importing merges another export into these."
      exportLabel="Export JSON"
      importLabel="Import JSON"
      download={() => ({
        filename: `rideshare-${new Date().toISOString().slice(0, 10)}.json`,
        text: serialize(data),
      })}
      merge={(incoming) => describeMerge(mergeIntoData(incoming))}
    />
  );
}
