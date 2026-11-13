import { describe, expect, it } from "vitest";
import { parseCsvText } from "./parseCsv";

const HEADER = "id,type,fields,input,why_boundary,expected_behavior";

describe("parseCsvText", () => {
  it("keeps commas, quotes, emojis and blank inputs exactly as written", () => {
    const csv = [
      HEADER,
      '1,Currency precision,"amount, currency","1500.50 JPY","JPY has no decimals","Reject, or round"',
      '2,Text encoding,note,"🍕 café שלום",Emojis,Store intact',
      '3,Empty values,note,"   ",Blank disguised as text,Treat as empty',
    ].join("\n");

    const { cases, error } = parseCsvText(csv);

    expect(error).toBeUndefined();
    expect(cases).toHaveLength(3);
    expect(cases[0].fields).toBe("amount, currency");
    expect(cases[0].expected_behavior).toBe("Reject, or round");
    expect(cases[1].input).toBe("🍕 café שלום");
    expect(cases[2].input).toBe("   ");
  });

  it("reports missing columns", () => {
    const { cases, error } = parseCsvText("id,type\n1,A");
    expect(cases).toEqual([]);
    expect(error).toContain("fields");
    expect(error).toContain("expected_behavior");
  });

  it("fills missing values with empty strings", () => {
    const { cases } = parseCsvText(`${HEADER}\n1,A,f`);
    expect(cases[0].input).toBe("");
    expect(cases[0].expected_behavior).toBe("");
  });

  it("reports a file with no rows", () => {
    const { error } = parseCsvText(HEADER);
    expect(error).toBe("The file has the right columns but no rows.");
  });

  it("ignores a byte order mark at the start", () => {
    const { cases, error } = parseCsvText(`\uFEFF${HEADER}\n1,A,f,i,w,e`);
    expect(error).toBeUndefined();
    expect(cases).toHaveLength(1);
  });
});
