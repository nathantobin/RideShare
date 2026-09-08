import { useRef } from "preact/hooks";
import { parseImport } from "../core/storage";
import type { AppData } from "../core/types";
import { downloadFile, readTextFile } from "./dom";
import { showError, showNote } from "./store";

interface DataBarProps {
  /** The line of explanation next to the buttons. */
  hint: string;
  exportLabel: string;
  importLabel: string;
  /** What to save, worked out when the button is pressed. */
  download: () => { filename: string; text: string };
  /** Fold a file in, and say what it brought. Throws to report a bad one. */
  merge: (incoming: AppData) => string;
}

/**
 * Export and import, used twice: for everything from the dashboard, and for one
 * trip from its own page. Only what the buttons say and what they do differs -
 * reading the file, reporting a bad one and clearing the input are the same job
 * either way.
 */
export function DataBar({ hint, exportLabel, importLabel, download, merge }: DataBarProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      showNote(merge(parseImport(await readTextFile(file))));
    } catch (problem) {
      showError(problem instanceof Error ? problem.message : "Couldn't import that file.");
    } finally {
      input.value = "";
    }
  };

  const save = () => {
    const { filename, text } = download();
    downloadFile(filename, text);
  };

  return (
    <div class="data-bar">
      <span>{hint}</span>
      <button class="ghost" onClick={save}>{exportLabel}</button>
      {/* No confirmation: merging only ever adds, so there's nothing to lose. */}
      <button class="ghost" onClick={() => fileInput.current?.click()}>{importLabel}</button>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
    </div>
  );
}

/** "Charleston, June" -> "charleston-june", for a filename. */
export function slug(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "trip";
}

/** What an import brought in, or that it brought nothing. */
export function describeMerge(counts: { trips?: number; rides: number }): string {
  const added = [
    counts.trips ? count(counts.trips, "trip") : "",
    counts.rides ? count(counts.rides, "ride") : "",
  ].filter(Boolean);
  return added.length === 0
    ? "Nothing new in that file - you already had all of it."
    : `Added ${added.join(" and ")}.`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
