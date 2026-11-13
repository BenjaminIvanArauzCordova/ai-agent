import Papa from "papaparse";
import { REQUIRED_COLUMNS } from "../types";
import type { BoundaryCase } from "../types";

export interface ParseResult {
  cases: BoundaryCase[];
  error?: string;
}

export function parseCsvText(text: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const columns = result.meta.fields ?? [];
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    return {
      cases: [],
      error: `This file is missing these columns: ${missing.join(", ")}.`,
    };
  }

  // Values are kept exactly as written: a boundary input can be a blank string.
  const cases = result.data.map((row) => {
    const boundaryCase = {} as BoundaryCase;
    for (const column of REQUIRED_COLUMNS) {
      boundaryCase[column] = row[column] ?? "";
    }
    return boundaryCase;
  });

  if (cases.length === 0) {
    return { cases: [], error: "The file has the right columns but no rows." };
  }
  return { cases };
}

export async function parseCsvFile(file: File): Promise<ParseResult> {
  return parseCsvText(await file.text());
}
