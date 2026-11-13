import { needsPolicy } from "../lib/filters";
import type { BoundaryCase } from "../types";

interface Props {
  cases: BoundaryCase[];
  colors: Record<string, string>;
  onClearFilters: () => void;
}

export function CasesTable({ cases, colors, onClearFilters }: Props) {
  if (cases.length === 0) {
    return (
      <div className="empty">
        <p>No cases match these filters.</p>
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Fields</th>
            <th>Input</th>
            <th>Why it is a boundary</th>
            <th>Expected behavior</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, index) => (
            <tr key={`${c.id}-${index}`} data-policy={needsPolicy(c)}>
              <td>{c.id}</td>
              <td>
                <span className="swatch" style={{ backgroundColor: colors[c.type] }} />
                {c.type}
              </td>
              <td>{c.fields}</td>
              <td className="input-cell">
                {c.input.trim() === "" ? (
                  <em className="blank">blank ({c.input.length} characters)</em>
                ) : (
                  c.input
                )}
              </td>
              <td>{c.why_boundary}</td>
              <td>{c.expected_behavior}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
