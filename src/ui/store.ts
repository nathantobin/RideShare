import { useEffect, useState } from "preact/hooks";
import { loadData, saveData, type StorageLike } from "../core/storage";
import { emptyData } from "../core/trips";
import type { AppData } from "../core/types";
import { ValidationError } from "../core/types";

/**
 * One mutable copy of the data, plus a way for components to hear about
 * changes. Trips and rides are edited in place by src/core, so components
 * re-render on a version bump rather than on a new object identity.
 */
let storage: StorageLike | null = null;
let data: AppData = emptyData();
let error: string | null = null;
let errorTimer: number | undefined;
let version = 0;
const listeners = new Set<() => void>();

export function initStore(from: StorageLike): void {
  storage = from;
  data = loadData(from);
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

export function useError(): string | null {
  useStore();
  return error;
}

export function showError(message: string | null): void {
  error = message;
  window.clearTimeout(errorTimer);
  if (message) {
    errorTimer = window.setTimeout(() => {
      error = null;
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

/** Replace everything, for import. */
export function replaceData(next: AppData): void {
  data = next;
  if (storage) saveData(storage, data);
  showError(null);
}
