export interface BoundaryCase {
  id: string;
  type: string;
  fields: string;
  input: string;
  why_boundary: string;
  expected_behavior: string;
}

export const REQUIRED_COLUMNS = [
  "id",
  "type",
  "fields",
  "input",
  "why_boundary",
  "expected_behavior",
] as const;
