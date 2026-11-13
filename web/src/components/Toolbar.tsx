interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  policyOnly: boolean;
  onPolicyOnlyChange: (value: boolean) => void;
  policyCount: number;
  shown: number;
  total: number;
  onExportJson: () => void;
  onExportCsv: () => void;
}

export function Toolbar({
  query,
  onQueryChange,
  policyOnly,
  onPolicyOnlyChange,
  policyCount,
  shown,
  total,
  onExportJson,
  onExportCsv,
}: Props) {
  return (
    <div className="toolbar">
      <input
        type="search"
        className="search"
        placeholder="Search in all columns"
        aria-label="Search in all columns"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={policyOnly}
          onChange={(e) => onPolicyOnlyChange(e.target.checked)}
        />
        Only cases that need a policy decision ({policyCount})
      </label>
      <p className="showing" aria-live="polite">
        Showing {shown} of {total}
      </p>
      <div className="exports">
        <button type="button" disabled={shown === 0} onClick={onExportJson}>
          Export JSON
        </button>
        <button type="button" disabled={shown === 0} onClick={onExportCsv}>
          Export CSV
        </button>
      </div>
    </div>
  );
}
