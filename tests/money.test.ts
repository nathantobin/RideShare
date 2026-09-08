import { describe, expect, it } from "vitest";
import { centsToInput, formatMoney, parseAmount } from "../src/core/money";
import { ValidationError } from "../src/core/types";

describe("parseAmount", () => {
  it("reads the ways people actually type a fare", () => {
    expect(parseAmount("48.50")).toBe(4850);
    expect(parseAmount("$48.50")).toBe(4850);
    expect(parseAmount(" 48 ")).toBe(4800);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount(".5")).toBe(50);
  });

  it("rounds to whole cents", () => {
    expect(parseAmount("10.005")).toBe(1001);
    expect(parseAmount("33.333")).toBe(3333);
  });

  it("rejects anything that isn't a positive amount", () => {
    for (const bad of ["", "   ", "abc", "12abc", "-5", "0", "$"]) {
      expect(() => parseAmount(bad), bad).toThrow(ValidationError);
    }
  });
});

describe("formatMoney", () => {
  it("formats positives, negatives and thousands", () => {
    expect(formatMoney(4850)).toBe("$48.50");
    expect(formatMoney(-2725)).toBe("-$27.25");
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("centsToInput", () => {
  it("round-trips through parseAmount", () => {
    for (const cents of [1, 999, 4850, 123456]) {
      expect(parseAmount(centsToInput(cents))).toBe(cents);
    }
  });
});
