import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

/**
 * Reading a PDF needs pdf.js, which is far bigger than the rest of the app put
 * together. Nothing in this file is loaded until someone actually picks a PDF -
 * see the dynamic import in UberImport - so the app still starts on a small
 * bundle and a browser that never opens a receipt never downloads any of it.
 */
GlobalWorkerOptions.workerPort = new PdfWorker();

/** Two runs of text within this many points of each other are on one line. */
const LINE_TOLERANCE = 3;

/** The bit of pdf.js's TextItem we use; the package doesn't export the type. */
interface TextRun {
  str: string;
  /** [scaleX, skewX, skewY, scaleY, x, y] in PDF space, y up from the bottom. */
  transform: number[];
}

/**
 * The text of a PDF receipt, laid back out in lines.
 *
 * A PDF has no lines, only runs of glyphs at coordinates, and Uber's receipts
 * put the label and the amount in separate columns. Reading the runs in the
 * file's own order can give "Total Subtotal $24.53 $21.53", so they're grouped
 * by how far down the page they sit and then read left to right, which puts the
 * receipt back into the shape the receipt parser expects.
 */
export async function readPdfText(file: File): Promise<string> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(toLines(content.items));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

function isTextRun(item: unknown): item is TextRun {
  return typeof item === "object" && item !== null && "str" in item && "transform" in item;
}

interface Line {
  y: number;
  runs: { x: number; text: string }[];
}

/** Takes the raw item list because pdf.js mixes marked-content markers in. */
function toLines(items: readonly unknown[]): string {
  const lines: Line[] = [];

  for (const item of items) {
    if (!isTextRun(item) || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= LINE_TOLERANCE);
    if (line) line.runs.push({ x, text: item.str });
    else lines.push({ y, runs: [{ x, text: item.str }] });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.runs.sort((a, b) => a.x - b.x).map((run) => run.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
