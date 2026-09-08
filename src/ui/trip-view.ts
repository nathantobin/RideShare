import { centsToInput, formatMoney } from "../core/money";
import { balancesFor, settleUp, tripTotalCents } from "../core/settle";
import {
  addPerson, addRide, autoDescription, isAutoDescribed, personName, removePerson, removeRide,
  renamePerson, renameTrip, routeLabel, updateRide,
} from "../core/trips";
import type { Balance, Ride, Trip } from "../core/types";
import type { ViewContext } from "./context";
import { $, $$, esc } from "./dom";

interface Draft {
  description: string;
  from: string;
  to: string;
  amount: string;
  paidBy: string;
  riders: Set<string>;
}

const STEP_RIDERS = 1;
const STEP_RIDES = 2;

/**
 * One trip's page: the riders, the rides, and what everyone owes. Holds the
 * half-typed ride form across re-renders so nothing is lost mid-entry.
 */
export class TripView {
  private openStep = STEP_RIDERS;
  private editingRideId: string | null = null;
  private draft: Draft = blankDraft(null);
  private shownTripId: string | null = null;

  constructor(private ctx: ViewContext) {}

  /** Called before each render so switching trips starts with a clean form. */
  private syncTo(trip: Trip): void {
    if (this.shownTripId === trip.id) return;
    this.shownTripId = trip.id;
    this.editingRideId = null;
    this.draft = blankDraft(trip);
    this.openStep = trip.people.length < 2 ? STEP_RIDERS : STEP_RIDES;
  }

  render(trip: Trip): string {
    this.syncTo(trip);
    const riders = `${trip.people.length} rider${trip.people.length === 1 ? "" : "s"}`;
    const rides = `${trip.rides.length} ride${trip.rides.length === 1 ? "" : "s"}`;
    return `
      <div class="page-head trip-head">
        <a class="back" href="#/">&larr; All trips</a>
        <h1>${esc(trip.name)} <button class="ghost" id="trip-rename" title="Rename trip">rename</button></h1>
        <p class="trip-meta">${riders} &middot; ${rides} &middot;
          <span class="money">${formatMoney(tripTotalCents(trip))}</span></p>
      </div>
      ${this.renderRidersStep(trip)}
      ${this.renderRidesStep(trip)}
      ${this.renderSettleStep(trip)}`;
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

  private renderRidersStep(trip: Trip): string {
    const tags = trip.people.map((person) => `
      <span class="person-tag">
        <button class="person-name" data-rename-person="${esc(person.id)}" title="Rename">${esc(person.name)}</button>
        <button data-remove-person="${esc(person.id)}" title="Remove">&times;</button>
      </span>`).join("");

    // Most trips are the same crew twice, so offer the last one's riders.
    const others = this.ctx.data.trips.filter((other) => other.id !== trip.id && other.people.length > 0);
    const copyRow = trip.people.length === 0 && others.length > 0
      ? `<label for="copy-from">Or bring the riders from another trip</label>
         <div class="row">
           <select id="copy-from">${others.map((other) =>
             `<option value="${esc(other.id)}">${esc(other.name)} (${other.people.length})</option>`).join("")}</select>
           <button id="copy-people">Copy</button>
         </div>`
      : "";

    const body = `
      <div class="chips people">${tags || '<span class="empty">Nobody yet.</span>'}</div>
      <label for="person-name">Who was along?</label>
      <div class="row">
        <input id="person-name" type="text" placeholder="Name" autocomplete="off">
        <button class="primary" id="person-add">Add</button>
      </div>
      ${copyRow}
      <p class="hint">A couple who always share a fare can be one entry, like "Sam-Alex". Click a name to rename.</p>
      <div class="actions">
        <button class="primary next" data-open="${STEP_RIDES}"${trip.people.length < 2 ? " disabled" : ""}>
          Next: rides &rarr;
        </button>
      </div>`;

    const summary = trip.people.length
      ? `${trip.people.length}: ${esc(trip.people.map((person) => person.name).join(", "))}`
      : "none yet";
    return this.step(STEP_RIDERS, "Riders", summary, body, { done: trip.people.length >= 2 });
  }

  private renderRidesStep(trip: Trip): string {
    if (trip.people.length === 0) return this.step(STEP_RIDES, "Rides", "", "", { locked: true });

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
    return this.step(STEP_RIDES, "Rides", summary, body, { done: trip.rides.length > 0 });
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

  private renderSettleStep(trip: Trip): string {
    if (trip.rides.length === 0) {
      return `
        <section class="step locked">
          <div class="step-head static">
            <span class="num">3</span><span class="step-title">Settle up</span>
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
          <span class="num">3</span><span class="step-title">Settle up</span>
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

  // ---------------------------------------------------------------- events

  wire(trip: Trip): void {
    const ctx = this.ctx;

    $$("[data-open]").forEach((button) => {
      button.onclick = () => {
        const step = Number(button.dataset.open);
        if (!step) return;
        this.openStep = this.openStep === step && button.classList.contains("step-head") ? 0 : step;
        ctx.render();
      };
    });

    const renameTripButton = $<HTMLButtonElement>("#trip-rename");
    if (renameTripButton) renameTripButton.onclick = () => {
      const name = window.prompt(`Rename "${trip.name}" to:`, trip.name);
      if (name !== null) ctx.commit(() => renameTrip(ctx.data, trip, name));
    };

    // --- riders
    const personInput = $<HTMLInputElement>("#person-name");
    const personAdd = $<HTMLButtonElement>("#person-add");
    if (personInput && personAdd) {
      const add = () => {
        if (!personInput.value.trim()) return;
        ctx.commit(() => {
          const person = addPerson(trip, personInput.value);
          this.draft.riders.add(person.id);
          if (!this.draft.paidBy) this.draft.paidBy = person.id;
        });
        $<HTMLInputElement>("#person-name")?.focus();
      };
      personAdd.onclick = add;
      personInput.onkeydown = (event) => { if (event.key === "Enter") add(); };
    }

    const copyButton = $<HTMLButtonElement>("#copy-people");
    const copyFrom = $<HTMLSelectElement>("#copy-from");
    if (copyButton && copyFrom) copyButton.onclick = () => {
      const source = ctx.data.trips.find((other) => other.id === copyFrom.value);
      if (!source) return;
      ctx.commit(() => {
        for (const person of source.people) {
          const added = addPerson(trip, person.name);
          this.draft.riders.add(added.id);
        }
        this.draft.paidBy = trip.people[0]?.id ?? "";
      });
    };

    $$("[data-remove-person]").forEach((button) => {
      button.onclick = () => {
        const personId = button.dataset.removePerson!;
        ctx.commit(() => { removePerson(trip, personId); this.draft.riders.delete(personId); });
      };
    });

    $$("[data-rename-person]").forEach((button) => {
      button.onclick = () => {
        const personId = button.dataset.renamePerson!;
        const current = personName(trip, personId);
        const name = window.prompt(`Rename "${current}" to:`, current);
        if (name !== null) ctx.commit(() => renamePerson(trip, personId, name));
      };
    });

    // --- the ride form. Inputs write straight to the draft, so a re-render
    //     never throws away what someone half-typed.
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
    if (everyone) everyone.onclick = () => {
      const selectAll = this.draft.riders.size < trip.people.length;
      this.draft.riders = new Set(selectAll ? trip.people.map((person) => person.id) : []);
      $$<HTMLInputElement>("[data-rider]").forEach((box) => {
        box.checked = this.draft.riders.has(box.dataset.rider!);
        box.closest(".chip")?.classList.toggle("on", box.checked);
      });
    };

    const save = $<HTMLButtonElement>("#ride-save");
    if (save) save.onclick = () => {
      const input = {
        description: this.draft.description,
        from: this.draft.from,
        to: this.draft.to,
        amount: this.draft.amount,
        paidBy: this.draft.paidBy || trip.people[0]?.id || "",
        riders: [...this.draft.riders],
      };
      const editingId = this.editingRideId;
      ctx.commit(
        () => { editingId ? updateRide(trip, editingId, input) : addRide(trip, input); },
        () => { this.editingRideId = null; this.draft = blankDraft(trip); },
      );
    };

    const amountInput = $<HTMLInputElement>("#ride-amount");
    if (amountInput) amountInput.onkeydown = (event) => { if (event.key === "Enter") save?.click(); };

    const cancel = $<HTMLButtonElement>("#ride-cancel");
    if (cancel) cancel.onclick = () => {
      this.editingRideId = null;
      this.draft = blankDraft(trip);
      ctx.render();
    };

    $$("[data-edit-ride]").forEach((button) => {
      button.onclick = () => {
        const ride = trip.rides.find((other) => other.id === button.dataset.editRide);
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
        ctx.render();
        $("#ride-from")?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });

    $$("[data-delete-ride]").forEach((button) => {
      button.onclick = () => {
        const ride = trip.rides.find((other) => other.id === button.dataset.deleteRide);
        if (!ride) return;
        if (!window.confirm(`Delete "${ride.description}" (${formatMoney(ride.amountCents)})?`)) return;
        ctx.commit(() => removeRide(trip, ride.id), () => {
          if (this.editingRideId === ride.id) {
            this.editingRideId = null;
            this.draft = blankDraft(trip);
          }
        });
      };
    });
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
