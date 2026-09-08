import { useEffect, useState } from "preact/hooks";
import { formatMoney } from "../core/money";
import { balancesFor, settleUp, tripTotalCents } from "../core/settle";
import {
  addPerson, personName, removePerson, removeRide, renamePerson, renameTrip, routeLabel,
} from "../core/trips";
import type { Ride, Trip } from "../core/types";
import { RideForm } from "./RideForm";
import { Step } from "./Step";
import { commit, useAppData } from "./store";

const STEP_RIDERS = 1;
const STEP_RIDES = 2;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function TripPage({ trip }: { trip: Trip }) {
  const [openStep, setOpenStep] = useState(trip.people.length < 2 ? STEP_RIDERS : STEP_RIDES);
  const [editingRideId, setEditingRideId] = useState<string | null>(null);

  // Switching trips starts fresh rather than carrying the last one's state.
  useEffect(() => {
    setOpenStep(trip.people.length < 2 ? STEP_RIDERS : STEP_RIDES);
    setEditingRideId(null);
  }, [trip.id]);

  const toggle = (step: number) => setOpenStep((current) => (current === step ? 0 : step));

  const rename = () => {
    const next = window.prompt(`Rename "${trip.name}" to:`, trip.name);
    if (next !== null) commit((data) => renameTrip(data, trip, next));
  };

  return (
    <>
      <div class="page-head trip-head">
        <a class="back" href="#/">← All trips</a>
        <h1>{trip.name} <button class="ghost" onClick={rename} title="Rename trip">rename</button></h1>
        <p class="trip-meta">
          {count(trip.people.length, "rider")} · {count(trip.rides.length, "ride")} ·{" "}
          <span class="money">{formatMoney(tripTotalCents(trip))}</span>
        </p>
      </div>

      <RidersStep trip={trip} open={openStep === STEP_RIDERS} onToggle={() => toggle(STEP_RIDERS)}
                  onNext={() => setOpenStep(STEP_RIDES)} />

      <RidesStep trip={trip} open={openStep === STEP_RIDES} onToggle={() => toggle(STEP_RIDES)}
                 editingRideId={editingRideId} setEditingRideId={setEditingRideId} />

      <SettleStep trip={trip} />
    </>
  );
}

interface StepProps {
  trip: Trip;
  open: boolean;
  onToggle: () => void;
}

function RidersStep({ trip, open, onToggle, onNext }: StepProps & { onNext: () => void }) {
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    if (commit(() => addPerson(trip, name))) setName("");
  };

  const rename = (personId: string) => {
    const current = personName(trip, personId);
    const next = window.prompt(`Rename "${current}" to:`, current);
    if (next !== null) commit(() => renamePerson(trip, personId, next));
  };

  const summary = trip.people.length
    ? `${trip.people.length}: ${trip.people.map((person) => person.name).join(", ")}`
    : "none yet";

  return (
    <Step number={STEP_RIDERS} title="Riders" summary={summary} open={open}
          done={trip.people.length >= 2} onToggle={onToggle}>
      <div class="chips people">
        {trip.people.length === 0 && <span class="empty">Nobody yet.</span>}
        {trip.people.map((person) => (
          <span key={person.id} class="person-tag">
            <button class="person-name" title="Rename" onClick={() => rename(person.id)}>{person.name}</button>
            <button title="Remove" onClick={() => commit(() => removePerson(trip, person.id))}>×</button>
          </span>
        ))}
      </div>

      <label for="person-name">Who was along?</label>
      <div class="row">
        <input id="person-name" type="text" placeholder="Name" autocomplete="off"
               value={name}
               onInput={(event) => setName(event.currentTarget.value)}
               onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
        <button class="primary" onClick={add}>Add</button>
      </div>

      {trip.people.length === 0 && <CopyRiders trip={trip} />}

      <p class="hint">A couple who always share a fare can be one entry, like "Sam-Alex". Click a name to rename.</p>
      <div class="actions">
        <button class="primary next" disabled={trip.people.length < 2} onClick={onNext}>Next: rides →</button>
      </div>
    </Step>
  );
}

/** Most trips are the same crew twice, so offer another trip's riders. */
function CopyRiders({ trip }: { trip: Trip }) {
  const [sourceId, setSourceId] = useState("");
  const data = useAppData();
  const others = data.trips.filter((other) => other.id !== trip.id && other.people.length > 0);
  if (others.length === 0) return null;
  const chosen = sourceId || others[0].id;

  const copy = () => {
    const source = others.find((other) => other.id === chosen);
    if (!source) return;
    commit(() => { for (const person of source.people) addPerson(trip, person.name); });
  };

  return (
    <>
      <label for="copy-from">Or bring the riders from another trip</label>
      <div class="row">
        <select id="copy-from" value={chosen} onChange={(event) => setSourceId(event.currentTarget.value)}>
          {others.map((other) => (
            <option key={other.id} value={other.id}>{other.name} ({other.people.length})</option>
          ))}
        </select>
        <button onClick={copy}>Copy</button>
      </div>
    </>
  );
}

function RidesStep({ trip, open, onToggle, editingRideId, setEditingRideId }: StepProps & {
  editingRideId: string | null;
  setEditingRideId: (id: string | null) => void;
}) {
  const editing = trip.rides.find((ride) => ride.id === editingRideId) ?? null;
  const summary = trip.rides.length
    ? `${count(trip.rides.length, "ride")}, ${formatMoney(tripTotalCents(trip))}`
    : "none yet";

  return (
    <Step number={STEP_RIDES} title="Rides" summary={summary} open={open}
          done={trip.rides.length > 0} locked={trip.people.length === 0} onToggle={onToggle}>
      <RideForm
        key={editing?.id ?? "new"}
        trip={trip}
        editing={editing}
        onDone={() => setEditingRideId(null)}
      />

      {trip.rides.length === 0
        ? <p class="hint">No rides logged yet.</p>
        : (
          <div class="rides">
            {trip.rides.map((ride) => (
              <RideRow key={ride.id} trip={trip} ride={ride}
                       editing={ride.id === editingRideId}
                       onEdit={() => setEditingRideId(ride.id)}
                       onDeleted={() => { if (ride.id === editingRideId) setEditingRideId(null); }} />
            ))}
          </div>
        )}
    </Step>
  );
}

function RideRow({ trip, ride, editing, onEdit, onDeleted }: {
  trip: Trip;
  ride: Ride;
  editing: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const route = routeLabel(ride);
  const remove = () => {
    if (!window.confirm(`Delete "${ride.description}" (${formatMoney(ride.amountCents)})?`)) return;
    if (commit(() => removeRide(trip, ride.id)) !== null) onDeleted();
  };

  return (
    <div class={editing ? "ride editing" : "ride"}>
      <div class="meta">
        <div class="desc">{ride.description}</div>
        <div class="sub">
          {route && route !== ride.description && <>{route} · </>}
          paid by {personName(trip, ride.paidBy)} · split {count(ride.riders.length, "way")}
        </div>
      </div>
      <div class="ride-actions">
        <div class="amt money">{formatMoney(ride.amountCents)}</div>
        <button class="ghost" onClick={onEdit}>edit</button>
        <button class="ghost" onClick={remove}>delete</button>
      </div>
    </div>
  );
}

function SettleStep({ trip }: { trip: Trip }) {
  if (trip.rides.length === 0) {
    return <Step number={3} title="Settle up" summary="add a ride first" open={false} locked />;
  }

  const balances = balancesFor(trip);
  const transfers = settleUp(balances);

  return (
    <Step number={3} title="Settle up" summary={count(transfers.length, "payment")} open done>
      <div class="total money">
        {formatMoney(tripTotalCents(trip))}
        <small>{count(trip.rides.length, "ride")} on {trip.name}</small>
      </div>

      <div class="payments">
        {transfers.length === 0
          ? <p class="empty">Everyone's square — no payments needed.</p>
          : transfers.map((transfer) => (
            <div class="transfer" key={`${transfer.fromPersonId}-${transfer.toPersonId}`}>
              <span>
                <strong>{personName(trip, transfer.fromPersonId)}</strong> pays{" "}
                <strong>{personName(trip, transfer.toPersonId)}</strong>
              </span>
              <span class="amt money">{formatMoney(transfer.amountCents)}</span>
            </div>
          ))}
      </div>

      <table>
        <thead>
          <tr><th>Person</th><th>Paid</th><th>Share</th><th>Net</th></tr>
        </thead>
        <tbody>
          {balances.map((balance) => (
            <tr key={balance.personId}>
              <td>{personName(trip, balance.personId)}</td>
              <td class="money">{formatMoney(balance.paidCents)}</td>
              <td class="money">{formatMoney(balance.shareCents)}</td>
              <td class={`money ${balance.netCents > 0 ? "pos" : balance.netCents < 0 ? "neg" : ""}`}>
                {formatMoney(balance.netCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p class="hint">Positive net = they're owed money.</p>
    </Step>
  );
}
