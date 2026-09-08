import { centsToInput, formatMoney } from "../core/money";
import { balancesFor, settleUp, tripTotalCents } from "../core/settle";
import { loadData, parseImport, saveData, serialize, type StorageLike } from "../core/storage";
import {
  activeTrip, addPerson, addRide, autoDescription, createTrip, deleteTrip, emptyData,
  isAutoDescribed, personName, removePerson, removeRide, renamePerson, renameTrip, routeLabel, updateRide,
} from "../core/trips";
import type { AppData, Balance, Ride, Trip } from "../core/types";
import { ValidationError } from "../core/types";
import { $, $$, downloadFile, esc, readTextFile } from "./dom";

interface Draft {
  description: string;
  from: string;
  to: string;
  amount: string;
  paidBy: string;
  riders: Set<string>;
}

const STEP_TRIP = 1;
const STEP_RIDERS = 2;
const STEP_RIDES = 3;

export class App {
  private data: AppData = emptyData();
  private openStep = STEP_TRIP;
  private editingRideId: string | null = null;
  private draft: Draft = blankDraft(null);
  private errorTimer: number | undefined;

  constructor(private root: HTMLElement, private storage: StorageLike) {}

  start(): void {
    this.data = loadData(this.storage);
    this.draft = blankDraft(activeTrip(this.data));
    this.openStep = this.firstIncompleteStep();
    this.render();
  }

  // ---------------------------------------------------------------- state

  private get trip(): Trip | null {
    return activeTrip(this.data);
  }

  private firstIncompleteStep(): number {
    const trip = this.trip;
    if (!trip) return STEP_TRIP;
    if (trip.people.length < 2) return STEP_RIDERS;
    return STEP_RIDES;
  }

  /** Run a change, persist it, and re-render - or show why it couldn't happen. */
  private commit(change: () => void, after?: () => void): boolean {
    try {
      change();
    } catch (error) {
      if (error instanceof ValidationError) {
        this.showError(error.message);
        return false;
      }
      throw error;
    }
    saveData(this.storage, this.data);
    after?.();
    this.render();
    return true;
  }

  private showError(message: string): void {
    const banner = $("#error");
    if (!banner) return;
    banner.textContent = message;
    window.clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      if (banner.textContent === message) banner.textContent = "";
    }, 6000);
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    this.root.innerHTML = [
      this.renderTripStep(),
      this.renderRidersStep(),
      this.renderRidesStep(),
      this.renderSettleStep(),
      this.renderDataBar(),
    ].join("");
    this.wire();
  }

  private step(n: number, title: string, summary: string, body: string,
               opts: { locked?: boolean; done?: boolean } = {}): string {
    const open = this.openStep === n && !opts.locked;
    return `
      <section class="step${open ? " open" : ""}${opts.locked ? " locked" : ""}${opts.done ? " done" : ""}">
        <button class="step-head" data-open="${opts.locked ? "" : n}"${opts.locked ? " disabled" : ""}>
          <span class="num">${n}</span>
          <span class="step-title">${esc(title)}</span>
          <span class="step-sum">${summary}</span>
        </button>
        <div class="step-body${open ? "" : " hidden"}">${body}</div>
      </section>`;
  }

  private renderTripStep(): string {
    const trip = this.trip;
    const picker = this.data.trips.length > 1
      ? `<label for="trip-picker">Which trip?</label>
         <select id="trip-picker">${this.data.trips.map((other) =>
           `<option value="${esc(other.id)}"${other.id === trip?.id ? " selected" : ""}>${esc(other.name)}</option>`,
         ).join("")}</select>`
      : "";

    const body = trip
      ? `${picker}
         <label for="trip-name">Start another trip</label>
         <div class="row">
           <input id="trip-name" type="text" placeholder="Austin, March 2026" autocomplete="off">
           <button id="trip-create">Create</button>
         </div>
         <p class="hint">A new trip starts empty, but can copy this trip's people into it.</p>
         <div class="actions">
           <button id="trip-rename" class="ghost">Rename trip</button>
           <button id="trip-delete" class="ghost">Delete trip</button>
           <button class="primary next" data-open="${STEP_RIDERS}">Next: riders &rarr;</button>
         </div>`
      : `<label for="trip-name">Name your trip</label>
         <div class="row">
           <input id="trip-name" type="text" placeholder="Charleston, June 2026" autocomplete="off">
           <button class="primary" id="trip-create">Create</button>
         </div>
         <p class="hint">Everything you log next belongs to this trip.</p>`;

    return this.step(STEP_TRIP, "Create a trip", trip ? esc(trip.name) : "none yet", body, { done: !!trip });
  }

  private renderRidersStep(): string {
    const trip = this.trip;
    if (!trip) return this.step(STEP_RIDERS, "Add riders", "", "", { locked: true });

    const tags = trip.people
      .map((person) => `
        <span class="person-tag">
          <button class="person-name" data-rename-person="${esc(person.id)}" title="Rename">${esc(person.name)}</button>
          <button data-remove-person="${esc(person.id)}" title="Remove">&times;</button>
        </span>`)
      .join("");

    const body = `
      <div class="chips people">${tags || '<span class="empty">Nobody yet.</span>'}</div>
      <label for="person-name">Who else was along?</label>
      <div class="row">
        <input id="person-name" type="text" placeholder="Name" autocomplete="off">
        <button class="primary" id="person-add">Add</button>
      </div>
      <p class="hint">A couple who always share a fare can be one entry, like "Sam-Alex". Click a name to rename.</p>
      <div class="actions">
        <button class="primary next" data-open="${STEP_RIDES}"${trip.people.length < 2 ? " disabled" : ""}>
          Next: rides &rarr;
        </button>
      </div>`;

    const summary = trip.people.length
      ? `${trip.people.length}: ${esc(trip.people.map((p) => p.name).join(", "))}`
      : "none yet";
    return this.step(STEP_RIDERS, "Add riders", summary, body, { done: trip.people.length >= 2 });
  }

  private renderRidesStep(): string {
    const trip = this.trip;
    if (!trip || trip.people.length === 0) return this.step(STEP_RIDES, "Add rides", "", "", { locked: true });

    const chips = trip.people.map((person) => `
      <label class="chip${this.draft.riders.has(person.id) ? " on" : ""}">
        <input type="checkbox" data-rider="${esc(person.id)}"${this.draft.riders.has(person.id) ? " checked" : ""}>
        ${esc(person.name)}
      </label>`).join("");

    const rides = trip.rides.map((ride) => this.renderRide(trip, ride)).join("");

    const body = `
      ${this.editingRideId ? '<p class="editing-note">Editing a ride &mdash; save or cancel below.</p>' : ""}
      <div class="pair">
        <div>
          <label for="ride-from">From</label>
          <input id="ride-from" type="text" placeholder="Hotel" value="${esc(this.draft.from)}" autocomplete="off">
        </div>
        <div>
          <label for="ride-to">To</label>
          <input id="ride-to" type="text" placeholder="Airport" value="${esc(this.draft.to)}" autocomplete="off">
        </div>
      </div>
      <label for="ride-description">Description <span class="normal">(optional)</span></label>
      <input id="ride-description" type="text" autocomplete="off"
             placeholder="${esc(autoDescription(this.draft.from, this.draft.to))}"
             value="${esc(this.draft.description)}">
      <label for="ride-amount">Total fare</label>
      <input id="ride-amount" type="text" inputmode="decimal" placeholder="48.50" value="${esc(this.draft.amount)}">
      <label for="ride-payer">Who paid the driver?</label>
      <select id="ride-payer">${trip.people.map((person) =>
        `<option value="${esc(person.id)}"${this.draft.paidBy === person.id ? " selected" : ""}>${esc(person.name)}</option>`,
      ).join("")}</select>
      <label>Who was in the car? <button class="ghost" id="ride-everyone" type="button">everyone</button></label>
      <div class="chips">${chips}</div>
      <div class="actions">
        <button class="primary" id="ride-save">${this.editingRideId ? "Save changes" : "Add ride"}</button>
        ${this.editingRideId ? '<button id="ride-cancel">Cancel</button>' : ""}
      </div>
      ${rides ? `<div class="rides">${rides}</div>` : '<p class="hint">No rides logged yet.</p>'}`;

    const summary = trip.rides.length
      ? `${trip.rides.length} ride${trip.rides.length === 1 ? "" : "s"}, ${formatMoney(tripTotalCents(trip))}`
      : "none yet";
    return this.step(STEP_RIDES, "Add rides", summary, body, { done: trip.rides.length > 0 });
  }

  private renderRide(trip: Trip, ride: Ride): string {
    const route = routeLabel(ride);
    const sub = [
      route && route !== ride.description ? esc(route) : "",
      `paid by ${esc(personName(trip, ride.paidBy))}`,
      `split ${ride.riders.length} way${ride.riders.length === 1 ? "" : "s"}`,
    ].filter(Boolean).join(" &middot; ");

    return `
      <div class="ride${ride.id === this.editingRideId ? " editing" : ""}">
        <div class="meta">
          <div class="desc">${esc(ride.description)}</div>
          <div class="sub">${sub}</div>
        </div>
        <div class="ride-actions">
          <div class="amt money">${formatMoney(ride.amountCents)}</div>
          <button class="ghost" data-edit-ride="${esc(ride.id)}">edit</button>
          <button class="ghost" data-delete-ride="${esc(ride.id)}">delete</button>
        </div>
      </div>`;
  }

  private renderSettleStep(): string {
    const trip = this.trip;
    const locked = !trip || trip.rides.length === 0;
    if (!trip || locked) {
      return `
        <section class="step locked">
          <div class="step-head static">
            <span class="num">4</span><span class="step-title">Settle up</span>
            <span class="step-sum">add a ride first</span>
          </div>
        </section>`;
    }

    const balances = balancesFor(trip);
    const transfers = settleUp(balances);
    const rows = balances.map((balance: Balance) => `
      <tr>
        <td>${esc(personName(trip, balance.personId))}</td>
        <td class="money">${formatMoney(balance.paidCents)}</td>
        <td class="money">${formatMoney(balance.shareCents)}</td>
        <td class="money ${balance.netCents > 0 ? "pos" : balance.netCents < 0 ? "neg" : ""}">
          ${formatMoney(balance.netCents)}
        </td>
      </tr>`).join("");

    const payments = transfers.length
      ? transfers.map((transfer) => `
          <div class="transfer">
            <span><strong>${esc(personName(trip, transfer.fromPersonId))}</strong> pays
                  <strong>${esc(personName(trip, transfer.toPersonId))}</strong></span>
            <span class="amt money">${formatMoney(transfer.amountCents)}</span>
          </div>`).join("")
      : '<p class="empty">Everyone\'s square &mdash; no payments needed.</p>';

    return `
      <section class="step done">
        <div class="step-head static">
          <span class="num">4</span><span class="step-title">Settle up</span>
          <span class="step-sum">${transfers.length} payment${transfers.length === 1 ? "" : "s"}</span>
        </div>
        <div class="step-body">
          <div class="total money">${formatMoney(tripTotalCents(trip))}
            <small>${trip.rides.length} ride${trip.rides.length === 1 ? "" : "s"} on ${esc(trip.name)}</small>
          </div>
          <div class="payments">${payments}</div>
          <table>
            <thead><tr><th>Person</th><th>Paid</th><th>Share</th><th>Net</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="hint">Positive net = they're owed money.</p>
        </div>
      </section>`;
  }

  private renderDataBar(): string {
    return `
      <div class="data-bar">
        <span>Trips are saved in this browser only.</span>
        <button class="ghost" id="data-export">Export JSON</button>
        <button class="ghost" id="data-import">Import JSON</button>
        <input type="file" id="data-file" accept="application/json,.json" hidden>
      </div>`;
  }

  // ---------------------------------------------------------------- events

  private wire(): void {
    const trip = this.trip;

    $$("[data-open]").forEach((button) => {
      button.onclick = () => {
        const step = Number(button.dataset.open);
        if (!step) return;
        this.openStep = this.openStep === step && button.classList.contains("step-head") ? 0 : step;
        this.render();
      };
    });

    // --- step 1: trips
    const picker = $<HTMLSelectElement>("#trip-picker");
    if (picker) picker.onchange = () => {
      this.editingRideId = null;
      this.commit(() => { this.data.activeTripId = picker.value; }, () => {
        this.draft = blankDraft(this.trip);
        this.openStep = this.firstIncompleteStep();
      });
    };

    const createButton = $<HTMLButtonElement>("#trip-create");
    const nameInput = $<HTMLInputElement>("#trip-name");
    if (createButton && nameInput) {
      createButton.onclick = () => {
        const copyFrom = trip && trip.people.length > 0
          && window.confirm(`Bring the ${trip.people.length} people from "${trip.name}" over?`)
          ? trip : null;
        this.editingRideId = null;
        this.commit(() => createTrip(this.data, nameInput.value, copyFrom), () => {
          this.draft = blankDraft(this.trip);
          this.openStep = this.firstIncompleteStep();
        });
      };
      nameInput.onkeydown = (event) => { if (event.key === "Enter") createButton.click(); };
    }

    const renameButton = $<HTMLButtonElement>("#trip-rename");
    if (renameButton && trip) renameButton.onclick = () => {
      const name = window.prompt(`Rename "${trip.name}" to:`, trip.name);
      if (name !== null) this.commit(() => renameTrip(this.data, trip, name));
    };

    const deleteButton = $<HTMLButtonElement>("#trip-delete");
    if (deleteButton && trip) deleteButton.onclick = () => {
      const count = trip.rides.length;
      if (!window.confirm(`Delete "${trip.name}" and its ${count} ride${count === 1 ? "" : "s"}? This can't be undone.`)) return;
      this.editingRideId = null;
      this.commit(() => deleteTrip(this.data, trip), () => {
        this.draft = blankDraft(this.trip);
        this.openStep = this.firstIncompleteStep();
      });
    };

    // --- step 2: riders
    const personInput = $<HTMLInputElement>("#person-name");
    const personAdd = $<HTMLButtonElement>("#person-add");
    if (personInput && personAdd && trip) {
      const add = () => {
        if (!personInput.value.trim()) return;
        this.commit(() => {
          const person = addPerson(trip, personInput.value);
          this.draft.riders.add(person.id);
          if (!this.draft.paidBy) this.draft.paidBy = person.id;
        }, () => { personInput.value = ""; });
        $<HTMLInputElement>("#person-name")?.focus();
      };
      personAdd.onclick = add;
      personInput.onkeydown = (event) => { if (event.key === "Enter") add(); };
    }

    $$("[data-remove-person]").forEach((button) => {
      button.onclick = () => {
        const personId = button.dataset.removePerson!;
        if (!trip) return;
        this.commit(() => { removePerson(trip, personId); this.draft.riders.delete(personId); });
      };
    });

    $$("[data-rename-person]").forEach((button) => {
      button.onclick = () => {
        if (!trip) return;
        const personId = button.dataset.renamePerson!;
        const current = personName(trip, personId);
        const name = window.prompt(`Rename "${current}" to:`, current);
        if (name !== null) this.commit(() => renamePerson(trip, personId, name));
      };
    });

    // --- step 3: the ride form (inputs write straight to the draft, so a
    //     re-render never throws away what someone half-typed)
    const bindInput = (selector: string, key: "from" | "to" | "description" | "amount", after?: () => void) => {
      const input = $<HTMLInputElement>(selector);
      if (input) input.oninput = () => { this.draft[key] = input.value; after?.(); };
    };
    const refreshPlaceholder = () => {
      const description = $<HTMLInputElement>("#ride-description");
      if (description) description.placeholder = autoDescription(this.draft.from, this.draft.to);
    };
    bindInput("#ride-from", "from", refreshPlaceholder);
    bindInput("#ride-to", "to", refreshPlaceholder);
    bindInput("#ride-description", "description");
    bindInput("#ride-amount", "amount");

    const payer = $<HTMLSelectElement>("#ride-payer");
    if (payer) payer.onchange = () => { this.draft.paidBy = payer.value; };

    $$<HTMLInputElement>("[data-rider]").forEach((box) => {
      box.onchange = () => {
        const personId = box.dataset.rider!;
        if (box.checked) this.draft.riders.add(personId);
        else this.draft.riders.delete(personId);
        box.closest(".chip")?.classList.toggle("on", box.checked);
      };
    });

    const everyone = $<HTMLButtonElement>("#ride-everyone");
    if (everyone && trip) everyone.onclick = () => {
      const selectAll = this.draft.riders.size < trip.people.length;
      this.draft.riders = new Set(selectAll ? trip.people.map((person) => person.id) : []);
      $$<HTMLInputElement>("[data-rider]").forEach((box) => {
        box.checked = this.draft.riders.has(box.dataset.rider!);
        box.closest(".chip")?.classList.toggle("on", box.checked);
      });
    };

    const save = $<HTMLButtonElement>("#ride-save");
    if (save && trip) save.onclick = () => {
      const input = {
        description: this.draft.description,
        from: this.draft.from,
        to: this.draft.to,
        amount: this.draft.amount,
        paidBy: this.draft.paidBy || trip.people[0]?.id || "",
        riders: [...this.draft.riders],
      };
      const editingId = this.editingRideId;
      this.commit(
        () => { editingId ? updateRide(trip, editingId, input) : addRide(trip, input); },
        () => { this.editingRideId = null; this.draft = blankDraft(trip); },
      );
    };

    const amountInput = $<HTMLInputElement>("#ride-amount");
    if (amountInput) amountInput.onkeydown = (event) => { if (event.key === "Enter") save?.click(); };

    const cancel = $<HTMLButtonElement>("#ride-cancel");
    if (cancel) cancel.onclick = () => {
      this.editingRideId = null;
      this.draft = blankDraft(this.trip);
      this.render();
    };

    $$("[data-edit-ride]").forEach((button) => {
      button.onclick = () => {
        const ride = trip?.rides.find((other) => other.id === button.dataset.editRide);
        if (!ride) return;
        this.editingRideId = ride.id;
        this.draft = {
          // An auto-named ride leaves the box blank so the name re-derives if
          // the stops change; a description someone typed is kept as-is.
          description: isAutoDescribed(ride) ? "" : ride.description,
          from: ride.from,
          to: ride.to,
          amount: centsToInput(ride.amountCents),
          paidBy: ride.paidBy,
          riders: new Set(ride.riders),
        };
        this.render();
        $("#ride-from")?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });

    $$("[data-delete-ride]").forEach((button) => {
      button.onclick = () => {
        const ride = trip?.rides.find((other) => other.id === button.dataset.deleteRide);
        if (!ride || !trip) return;
        if (!window.confirm(`Delete "${ride.description}" (${formatMoney(ride.amountCents)})?`)) return;
        this.commit(() => removeRide(trip, ride.id), () => {
          if (this.editingRideId === ride.id) {
            this.editingRideId = null;
            this.draft = blankDraft(trip);
          }
        });
      };
    });

    // --- import / export
    const exportButton = $<HTMLButtonElement>("#data-export");
    if (exportButton) exportButton.onclick = () => {
      downloadFile(`rideshare-${new Date().toISOString().slice(0, 10)}.json`, serialize(this.data));
    };

    const importButton = $<HTMLButtonElement>("#data-import");
    const fileInput = $<HTMLInputElement>("#data-file");
    if (importButton && fileInput) {
      importButton.onclick = () => {
        if (this.data.trips.length > 0
            && !window.confirm("Importing replaces the trips saved in this browser. Export first if you want a copy. Continue?")) return;
        fileInput.click();
      };
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const imported = parseImport(await readTextFile(file));
          this.editingRideId = null;
          this.commit(() => { this.data = imported; }, () => {
            this.draft = blankDraft(this.trip);
            this.openStep = this.firstIncompleteStep();
          });
        } catch (error) {
          this.showError(error instanceof Error ? error.message : "Couldn't import that file.");
        } finally {
          fileInput.value = "";
        }
      };
    }
  }
}

function blankDraft(trip: Trip | null): Draft {
  return {
    description: "",
    from: "",
    to: "",
    amount: "",
    paidBy: trip?.people[0]?.id ?? "",
    riders: new Set(trip?.people.map((person) => person.id) ?? []),
  };
}
