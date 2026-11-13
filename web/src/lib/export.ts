import Papa from "papaparse";
import { REQUIRED_COLUMNS } from "../types";
import type { BoundaryCase } from "../types";

export function toJson(cases: BoundaryCase[]): string {
  return JSON.stringify(cases, null, 2);
}

export function toCsv(cases: BoundaryCase[]): string {
  return Papa.unparse(cases, { columns: [...REQUIRED_COLUMNS] });
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
