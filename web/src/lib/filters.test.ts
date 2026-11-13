import { describe, expect, it } from "vitest";
import { countByType, filterCases, needsPolicy } from "./filters";
import type { BoundaryCase } from "../types";

const make = (id: string, type: string, input: string, expected: string): BoundaryCase => ({
  id,
  type,
  fields: "amount",
  input,
  why_boundary: "reason",
  expected_behavior: expected,
});

const cases = [
  make("1", "Extreme amounts", "0.00", "Reject"),
  make("2", "Extreme amounts", "-5.00", "Define policy: refund or reject"),
  make("3", "Dates", "2025-02-29", "Reject"),
];

const none = { types: new Set<string>(), query: "", policyOnly: false };

describe("filterCases", () => {
  it("returns everything when no filter is active", () => {
    expect(filterCases(cases, none)).toHaveLength(3);
  });

  it("filters by selected types", () => {
    const result = filterCases(cases, { ...none, types: new Set(["Dates"]) });
    expect(result.map((c) => c.id)).toEqual(["3"]);
  });

  it("searches every column, ignoring case", () => {
    expect(filterCases(cases, { ...none, query: "REFUND" }).map((c) => c.id)).toEqual(["2"]);
    expect(filterCases(cases, { ...none, query: "2025" }).map((c) => c.id)).toEqual(["3"]);
  });

  it("keeps only cases that need a policy decision", () => {
    expect(filterCases(cases, { ...none, policyOnly: true }).map((c) => c.id)).toEqual(["2"]);
  });

  it("combines filters", () => {
    const result = filterCases(cases, {
      types: new Set(["Extreme amounts"]),
      query: "reject",
      policyOnly: false,
    });
    expect(result.map((c) => c.id)).toEqual(["1", "2"]);
  });
});

describe("countByType", () => {
  it("counts cases keeping the order of first appearance", () => {
    expect(countByType(cases)).toEqual([
      { type: "Extreme amounts", count: 2 },
      { type: "Dates", count: 1 },
    ]);
  });
});

describe("needsPolicy", () => {
  it("detects the marker in any letter case", () => {
    expect(needsPolicy(make("9", "T", "x", "define POLICY"))).toBe(true);
    expect(needsPolicy(make("9", "T", "x", "Reject"))).toBe(false);
  });
});
