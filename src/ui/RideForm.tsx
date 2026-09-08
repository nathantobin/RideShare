import { useState } from "preact/hooks";
import { centsToInput } from "../core/money";
import { addRide, autoDescription, isAutoDescribed, updateRide } from "../core/trips";
import type { Ride, Trip } from "../core/types";
import { commit } from "./store";

interface RideFormProps {
  trip: Trip;
  /** The ride being changed, or null when adding a new one. */
  editing: Ride | null;
  onDone: () => void;
}

/**
 * Add or edit one ride. Mounted with a `key` of the ride's id, so switching
 * between adding and editing starts the fields from scratch.
 */
export function RideForm({ trip, editing, onDone }: RideFormProps) {
  // An auto-named ride starts with a blank description so the name re-derives
  // if the stops change; a description someone typed is kept as-is.
  const [description, setDescription] = useState(
    editing && !isAutoDescribed(editing) ? editing.description : "",
  );
  const [from, setFrom] = useState(editing?.from ?? "");
  const [to, setTo] = useState(editing?.to ?? "");
  const [amount, setAmount] = useState(editing ? centsToInput(editing.amountCents) : "");
  const [paidBy, setPaidBy] = useState(editing?.paidBy ?? trip.people[0]?.id ?? "");
  const [riders, setRiders] = useState<Set<string>>(
    new Set(editing ? editing.riders : trip.people.map((person) => person.id)),
  );

  const toggleRider = (personId: string) => {
    const next = new Set(riders);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    setRiders(next);
  };

  const everyone = () => {
    const selectAll = riders.size < trip.people.length;
    setRiders(new Set(selectAll ? trip.people.map((person) => person.id) : []));
  };

  const save = () => {
    const input = {
      description,
      from,
      to,
      amount,
      paidBy: paidBy || trip.people[0]?.id || "",
      riders: [...riders],
    };
    const saved = commit(() => (editing ? updateRide(trip, editing.id, input) : addRide(trip, input)));
    if (!saved) return;
    // Editing hands control back, which remounts this form empty. Adding stays
    // put, ready for the next ride, so clear the fields here.
    if (editing) onDone();
    else clear();
  };

  const clear = () => {
    setDescription("");
    setFrom("");
    setTo("");
    setAmount("");
    setPaidBy(trip.people[0]?.id ?? "");
    setRiders(new Set(trip.people.map((person) => person.id)));
  };

  return (
    <>
      {editing && <p class="editing-note">Editing a ride — save or cancel below.</p>}

      <div class="pair">
        <div>
          <label for="ride-from">From</label>
          <input id="ride-from" type="text" placeholder="Hotel" autocomplete="off"
                 value={from} onInput={(event) => setFrom(event.currentTarget.value)} />
        </div>
        <div>
          <label for="ride-to">To</label>
          <input id="ride-to" type="text" placeholder="Airport" autocomplete="off"
                 value={to} onInput={(event) => setTo(event.currentTarget.value)} />
        </div>
      </div>

      <label for="ride-description">Description <span class="normal">(optional)</span></label>
      <input id="ride-description" type="text" autocomplete="off"
             placeholder={autoDescription(from, to)}
             value={description} onInput={(event) => setDescription(event.currentTarget.value)} />

      <label for="ride-amount">Total fare</label>
      <input id="ride-amount" type="text" inputMode="decimal" placeholder="48.50"
             value={amount}
             onInput={(event) => setAmount(event.currentTarget.value)}
             onKeyDown={(event) => { if (event.key === "Enter") save(); }} />

      <label for="ride-payer">Who paid the driver?</label>
      <select id="ride-payer" value={paidBy} onChange={(event) => setPaidBy(event.currentTarget.value)}>
        {trip.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>

      <label>
        Who was in the car?
        <button class="ghost" type="button" onClick={everyone}>everyone</button>
      </label>
      <div class="chips">
        {trip.people.map((person) => (
          <label key={person.id} class={riders.has(person.id) ? "chip on" : "chip"}>
            <input type="checkbox" checked={riders.has(person.id)} onChange={() => toggleRider(person.id)} />
            {person.name}
          </label>
        ))}
      </div>

      <div class="actions">
        <button class="primary" onClick={save}>{editing ? "Save changes" : "Add ride"}</button>
        {editing && <button onClick={onDone}>Cancel</button>}
      </div>
    </>
  );
}
