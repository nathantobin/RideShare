import { useEffect, useState } from "preact/hooks";
import { mergeData, mergeTripFrom, summariseMerge } from "../core/merge";
import { loadData, saveData, type StorageLike } from "../core/storage";
import { emptyData } from "../core/trips";
import type { AppData } from "../core/types";
import { ValidationError } from "../core/types";

/** Something to say at the top of the screen: what went wrong, or what landed. */
export interface Flash {
  kind: "error" | "note";
  message: string;
}

/**
 * One mutable copy of the data, plus a way for components to hear about
 * changes. Trips and rides are edited in place by src/core, so components
 * re-render on a version bump rather than on a new object identity.
 */
let storage: StorageLike | null = null;
let data: AppData = emptyData();
let flash: Flash | null = null;
let flashTimer: number | undefined;
let version = 0;
const listeners = new Set<() => void>();

export function initStore(from: StorageLike): void {
  storage = from;
  data = loadData(from);
  // A banner is about what just happened, so a fresh store starts without one.
  flash = null;
  window.clearTimeout(flashTimer);
  bump();
}

function bump(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Re-render this component whenever the store changes. */
function useStore(): void {
  const [, setSeen] = useState(version);
  useEffect(() => {
    const listener = () => setSeen(version);
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);
}

export function useAppData(): AppData {
  useStore();
  return data;
}

export function useFlash(): Flash | null {
  useStore();
  return flash;
}

export function showError(message: string | null): void {
  show(message === null ? null : { kind: "error", message });
}

export function showNote(message: string): void {
  show({ kind: "note", message });
}

function show(next: Flash | null): void {
  flash = next;
  window.clearTimeout(flashTimer);
  if (next) {
    flashTimer = window.setTimeout(() => {
      flash = null;
      bump();
    }, 6000);
  }
  bump();
}

/**
 * Apply a change, persist it and re-render. Returns whatever the change
 * returned, or null if it was rejected - in which case the reason is already
 * on screen and nothing was saved.
 */
export function commit<T>(change: (data: AppData) => T): T | null {
  let result: T;
  try {
    result = change(data);
  } catch (problem) {
    if (problem instanceof ValidationError) {
      showError(problem.message);
      return null;
    }
    throw problem;
  }
  if (storage) saveData(storage, data);
  showError(null);
  return result;
}

/**
 * Fold an imported file into what's already here, and say what it brought.
 *
 * Import used to replace everything, which meant two people on one trip could
 * only ever hand the whole thing back and forth. Merging means both of you can
 * log rides and neither copy loses any.
 */
export function mergeIntoData(incoming: AppData): { trips: number; rides: number } {
  const before = data;
  data = mergeData(before, incoming);
  if (storage) saveData(storage, data);
  bump();
  return summariseMerge(before, data);
}

/**
 * The same, for one trip: what a file says about the trip you're looking at,
 * and nothing it says about any other. Throws if the file hasn't got it, before
 * anything is changed or saved.
 */
export function mergeIntoTrip(incoming: AppData, tripId: string): { rides: number } {
  const before = data;
  const merged = mergeTripFrom(before, incoming, tripId);
  data = merged;
  if (storage) saveData(storage, data);
  bump();
  return { rides: summariseMerge(before, data).rides };
}
