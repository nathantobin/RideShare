import { describe, expect, it } from "vitest";
import { hashFor, parseHash, sameRoute } from "../src/ui/router";

describe("parseHash", () => {
  it("treats an empty or root hash as the dashboard", () => {
    for (const hash of ["", "#", "#/", "  "]) {
      expect(parseHash(hash)).toEqual({ name: "dashboard" });
    }
  });

  it("reads a trip id", () => {
    expect(parseHash("#/trip/abc-123")).toEqual({ name: "trip", tripId: "abc-123" });
  });

  it("decodes ids that needed escaping", () => {
    expect(parseHash("#/trip/a%2Fb")).toEqual({ name: "trip", tripId: "a/b" });
  });

  it("falls back to the dashboard for anything it doesn't recognise", () => {
    for (const hash of ["#/trip", "#/trip/", "#/nonsense", "#/settings/1"]) {
      expect(parseHash(hash), hash).toEqual({ name: "dashboard" });
    }
  });
});

describe("hashFor", () => {
  it("round-trips through parseHash", () => {
    for (const route of [{ name: "dashboard" } as const, { name: "trip", tripId: "a/b c" } as const]) {
      expect(parseHash(hashFor(route))).toEqual(route);
    }
  });

  it("compares routes by their url", () => {
    expect(sameRoute({ name: "trip", tripId: "x" }, { name: "trip", tripId: "x" })).toBe(true);
    expect(sameRoute({ name: "trip", tripId: "x" }, { name: "trip", tripId: "y" })).toBe(false);
    expect(sameRoute({ name: "dashboard" }, { name: "trip", tripId: "x" })).toBe(false);
  });
});
