import { ValidationError } from "./types";

const FORMATTER = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.56", or "-$1,234.56" for a negative balance. */
export function formatMoney(cents: number): string {
  return FORMATTER.format(cents / 100);
}

/**
 * Parse what someone typed into whole cents: "48.50", "$48.50", "1,234", "48".
 * Throws ValidationError rather than silently producing NaN.
 */
export function parseAmount(input: string | number): number {
  const text = String(input).trim().replace(/[$,\s]/g, "");
  if (!text) throw new ValidationError("Enter an amount.");
  if (!/^\d*\.?\d*$/.test(text)) throw new ValidationError(`"${input}" isn't a number.`);
  const cents = Math.round(Number(text) * 100);
  if (!Number.isFinite(cents)) throw new ValidationError(`"${input}" isn't a number.`);
  if (cents <= 0) throw new ValidationError("Amount must be greater than zero.");
  return cents;
}

/** Cents back to an editable string: 4850 -> "48.50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
