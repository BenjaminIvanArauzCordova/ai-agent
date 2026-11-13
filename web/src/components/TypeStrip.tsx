import type { TypeCount } from "../lib/filters";

interface Props {
  counts: TypeCount[];
  colors: Record<string, string>;
  selected: ReadonlySet<string>;
  onToggle: (type: string) => void;
}

export function TypeStrip({ counts, colors, selected, onToggle }: Props) {
  const isDimmed = (type: string) => selected.size > 0 && !selected.has(type);

  return (
    <section className="types" aria-label="Cases by type">
      <div className="strip">
        {counts.map(({ type, count }) => (
          <button
            key={type}
            type="button"
            className="strip-segment"
            style={{ flexGrow: count, backgroundColor: colors[type] }}
            data-dimmed={isDimmed(type)}
            aria-pressed={selected.has(type)}
            aria-label={`${type}: ${count} cases`}
            title={`${type}: ${count}`}
            onClick={() => onToggle(type)}
          />
        ))}
      </div>
      <ul className="legend">
        {counts.map(({ type, count }) => (
          <li key={type}>
            <button
              type="button"
              className="legend-item"
              data-dimmed={isDimmed(type)}
              aria-pressed={selected.has(type)}
              onClick={() => onToggle(type)}
            >
              <span className="swatch" style={{ backgroundColor: colors[type] }} />
              {type}
              <span className="legend-count">{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
