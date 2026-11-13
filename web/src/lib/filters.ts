import { REQUIRED_COLUMNS } from "../types";
import type { BoundaryCase } from "../types";

export interface Filters {
  types: ReadonlySet<string>;
  query: string;
  policyOnly: boolean;
}

export interface TypeCount {
  type: string;
  count: number;
}

export function needsPolicy(boundaryCase: BoundaryCase): boolean {
  return /define policy/i.test(boundaryCase.expected_behavior);
}

export function filterCases(cases: BoundaryCase[], filters: Filters): BoundaryCase[] {
  const query = filters.query.trim().toLowerCase();
  return cases.filter((boundaryCase) => {
    if (filters.types.size > 0 && !filters.types.has(boundaryCase.type)) return false;
    if (filters.policyOnly && !needsPolicy(boundaryCase)) return false;
    if (query === "") return true;
    return REQUIRED_COLUMNS.some((column) =>
      boundaryCase[column].toLowerCase().includes(query),
    );
  });
}

export function countByType(cases: BoundaryCase[]): TypeCount[] {
  const counts = new Map<string, number>();
  for (const boundaryCase of cases) {
    counts.set(boundaryCase.type, (counts.get(boundaryCase.type) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, count }));
}
