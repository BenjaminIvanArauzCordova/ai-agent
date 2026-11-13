import { Fragment, useState } from "react";
import { needsPolicy } from "../lib/filters";
import type { BoundaryCase } from "../types";

interface Props {
  cases: BoundaryCase[];
  colors: Record<string, string>;
  onClearFilters: () => void;
}

const COLUMN_COUNT = 7;

export function CasesTable({ cases, colors, onClearFilters }: Props) {
  const [open, setOpen] = useState<ReadonlySet<BoundaryCase>>(new Set());
  const [copied, setCopied] = useState<BoundaryCase | null>(null);

  const toggle = (boundaryCase: BoundaryCase) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(boundaryCase)) next.delete(boundaryCase);
      else next.add(boundaryCase);
      return next;
    });
  };

  const copyInput = async (boundaryCase: BoundaryCase) => {
    try {
      await navigator.clipboard.writeText(boundaryCase.input);
      setCopied(boundaryCase);
      window.setTimeout(
        () => setCopied((current) => (current === boundaryCase ? null : current)),
        1500,
      );
    } catch {
      // The browser can block clipboard access; the text stays selectable.
    }
  };

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
            <th className="toggle-col">
              <span className="visually-hidden">Details</span>
            </th>
            <th>ID</th>
            <th>Type</th>
            <th>Fields</th>
            <th>Input</th>
            <th>Why it is a boundary</th>
            <th>Expected behavior</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, index) => {
            const isOpen = open.has(c);
            const panelId = `case-details-${index}`;
            return (
              <Fragment key={`${c.id}-${index}`}>
                <tr data-policy={needsPolicy(c)} data-open={isOpen}>
                  <td className="toggle-col">
                    <button
                      type="button"
                      className="toggle"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      aria-label={`${isOpen ? "Hide" : "Show"} full details for case ${c.id}`}
                      onClick={() => toggle(c)}
                    >
                      <span className="chevron" aria-hidden="true" />
                    </button>
                  </td>
                  <td>{c.id}</td>
                  <td>
                    <span className="swatch" style={{ backgroundColor: colors[c.type] }} />
                    {c.type}
                  </td>
                  <td>{c.fields}</td>
                  <td className="input-cell">
                    <div className="clip">
                      {c.input.trim() === "" ? (
                        <em className="blank">blank ({c.input.length} characters)</em>
                      ) : (
                        c.input
                      )}
                    </div>
                  </td>
                  <td>{c.why_boundary}</td>
                  <td>{c.expected_behavior}</td>
                </tr>
                {isOpen && (
                  <tr className="detail-row" data-policy={needsPolicy(c)}>
                    <td colSpan={COLUMN_COUNT} id={panelId}>
                      <div className="detail">
                        <div className="detail-head">
                          <h3>Full input ({c.input.length} characters)</h3>
                          <button type="button" className="ghost" onClick={() => copyInput(c)}>
                            {copied === c ? "Copied" : "Copy input"}
                          </button>
                        </div>
                        <pre className="detail-input">
                          {c.input === "" ? "(empty)" : c.input}
                        </pre>
                        <dl className="detail-list">
                          <div>
                            <dt>Fields</dt>
                            <dd>{c.fields}</dd>
                          </div>
                          <div>
                            <dt>Why it is a boundary</dt>
                            <dd>{c.why_boundary}</dd>
                          </div>
                          <div>
                            <dt>Expected behavior</dt>
                            <dd>{c.expected_behavior}</dd>
                          </div>
                        </dl>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}