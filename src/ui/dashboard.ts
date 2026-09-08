import { formatMoney } from "../core/money";
import { balancesFor, settleUp, tripTotalCents } from "../core/settle";
import { parseImport, serialize } from "../core/storage";
import { createTrip, deleteTrip, renameTrip } from "../core/trips";
import type { Trip } from "../core/types";
import type { ViewContext } from "./context";
import { $, $$, downloadFile, esc, readTextFile } from "./dom";

/** Newest first, which is the trip you're most likely still adding to. */
function ordered(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

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

export function renderDashboard(ctx: ViewContext): string {
  const trips = ordered(ctx.data.trips);

  const cards = trips.map((trip) => {
    const riders = `${trip.people.length} rider${trip.people.length === 1 ? "" : "s"}`;
    const rides = `${trip.rides.length} ride${trip.rides.length === 1 ? "" : "s"}`;
    return `
      <li class="trip-card">
        <a class="trip-open" href="#/trip/${encodeURIComponent(trip.id)}">
          <span class="trip-name">${esc(trip.name)}</span>
          <span class="trip-meta">${riders} &middot; ${rides} &middot; <span class="money">${formatMoney(tripTotalCents(trip))}</span></span>
          <span class="trip-status">${esc(statusOf(trip))}</span>
        </a>
        <div class="trip-card-actions">
          <span class="trip-date">${esc(formatDate(trip.createdAt))}</span>
          <button class="ghost" data-rename-trip="${esc(trip.id)}">Rename</button>
          <button class="ghost danger" data-delete-trip="${esc(trip.id)}">Delete</button>
        </div>
      </li>`;
  }).join("");

  const list = trips.length
    ? `<ul class="trip-list">${cards}</ul>`
    : `<p class="empty-state">No trips yet. Name your first one above &mdash; a weekend, a city, whatever
       you'll recognise later &mdash; then add the people and the rides.</p>`;

  return `
    <div class="page-head">
      <h1>Your trips</h1>
    </div>
    <div class="card new-trip">
      <label for="trip-name">Start a trip</label>
      <div class="row">
        <input id="trip-name" type="text" placeholder="Charleston, June 2026" autocomplete="off">
        <button class="primary" id="trip-create">Create</button>
      </div>
    </div>
    ${list}
    <div class="data-bar">
      <span>Trips are saved in this browser only.</span>
      <button class="ghost" id="data-export">Export JSON</button>
      <button class="ghost" id="data-import">Import JSON</button>
      <input type="file" id="data-file" accept="application/json,.json" hidden>
    </div>`;
}

export function wireDashboard(ctx: ViewContext): void {
  const nameInput = $<HTMLInputElement>("#trip-name");
  const createButton = $<HTMLButtonElement>("#trip-create");
  if (nameInput && createButton) {
    createButton.onclick = () => {
      let created: Trip | null = null;
      ctx.commit(
        () => { created = createTrip(ctx.data, nameInput.value); },
        () => { if (created) ctx.navigate({ name: "trip", tripId: created.id }); },
      );
    };
    nameInput.onkeydown = (event) => { if (event.key === "Enter") createButton.click(); };
  }

  $$("[data-rename-trip]").forEach((button) => {
    button.onclick = () => {
      const trip = ctx.data.trips.find((other) => other.id === button.dataset.renameTrip);
      if (!trip) return;
      const name = window.prompt(`Rename "${trip.name}" to:`, trip.name);
      if (name !== null) ctx.commit(() => renameTrip(ctx.data, trip, name));
    };
  });

  $$("[data-delete-trip]").forEach((button) => {
    button.onclick = () => {
      const trip = ctx.data.trips.find((other) => other.id === button.dataset.deleteTrip);
      if (!trip) return;
      const count = trip.rides.length;
      const detail = count === 0 ? "" : ` and its ${count} ride${count === 1 ? "" : "s"}`;
      if (!window.confirm(`Delete "${trip.name}"${detail}? This can't be undone.`)) return;
      ctx.commit(() => deleteTrip(ctx.data, trip));
    };
  });

  const exportButton = $<HTMLButtonElement>("#data-export");
  if (exportButton) exportButton.onclick = () => {
    downloadFile(`rideshare-${new Date().toISOString().slice(0, 10)}.json`, serialize(ctx.data));
  };

  const importButton = $<HTMLButtonElement>("#data-import");
  const fileInput = $<HTMLInputElement>("#data-file");
  if (importButton && fileInput) {
    importButton.onclick = () => {
      if (ctx.data.trips.length > 0 && !window.confirm(
        "Importing replaces the trips saved in this browser. Export first if you want a copy. Continue?",
      )) return;
      fileInput.click();
    };
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const imported = parseImport(await readTextFile(file));
        ctx.commit(() => ctx.setData(imported));
      } catch (error) {
        ctx.showError(error instanceof Error ? error.message : "Couldn't import that file.");
      } finally {
        fileInput.value = "";
      }
    };
  }
}
