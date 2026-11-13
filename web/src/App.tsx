import { useMemo, useState } from "react";
import { CasesTable } from "./components/CasesTable";
import { DropZone } from "./components/DropZone";
import { Toolbar } from "./components/Toolbar";
import { TypeStrip } from "./components/TypeStrip";
import { downloadText, toCsv, toJson } from "./lib/export";
import { countByType, filterCases, needsPolicy } from "./lib/filters";
import { parseCsvFile } from "./lib/parseCsv";
import type { BoundaryCase } from "./types";
import "./App.css";

// Golden-angle hues give every type its own color, however many types there are.
const colorForType = (index: number) => `hsl(${Math.round((index * 137.5) % 360)} 42% 40%)`;

export default function App() {
  const [cases, setCases] = useState<BoundaryCase[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [policyOnly, setPolicyOnly] = useState(false);

  const counts = useMemo(() => countByType(cases), [cases]);
  const colors = useMemo(() => {
    const map: Record<string, string> = {};
    counts.forEach(({ type }, index) => {
      map[type] = colorForType(index);
    });
    return map;
  }, [counts]);
  const filtered = useMemo(
    () => filterCases(cases, { types: selected, query, policyOnly }),
    [cases, selected, query, policyOnly],
  );
  const policyCount = useMemo(() => cases.filter(needsPolicy).length, [cases]);

  const clearFilters = () => {
    setSelected(new Set());
    setQuery("");
    setPolicyOnly(false);
  };

  const handleFile = async (file: File) => {
    const result = await parseCsvFile(file);
    clearFilters();
    if (result.error) {
      setError(result.error);
      setCases([]);
      setFileName("");
      return;
    }
    setError("");
    setCases(result.cases);
    setFileName(file.name);
  };

  const toggleType = (type: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const baseName = fileName.replace(/\.csv$/i, "") || "boundary-cases";
  const exportJson = () =>
    downloadText(`${baseName}-filtered.json`, toJson(filtered), "application/json");
  const exportCsv = () =>
    downloadText(`${baseName}-filtered.csv`, toCsv(filtered), "text/csv");

  const hasData = cases.length > 0;

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Edge Data Lab</h1>
          {hasData && (
            <p className="file-info">
              {fileName} has {cases.length} cases in {counts.length} types
            </p>
          )}
        </div>
        {hasData && <DropZone onFile={handleFile} compact />}
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!hasData && <DropZone onFile={handleFile} />}

      {hasData && (
        <>
          <TypeStrip
            counts={counts}
            colors={colors}
            selected={selected}
            onToggle={toggleType}
          />
          <Toolbar
            query={query}
            onQueryChange={setQuery}
            policyOnly={policyOnly}
            onPolicyOnlyChange={setPolicyOnly}
            policyCount={policyCount}
            shown={filtered.length}
            total={cases.length}
            onExportJson={exportJson}
            onExportCsv={exportCsv}
          />
          <CasesTable cases={filtered} colors={colors} onClearFilters={clearFilters} />
        </>
      )}
    </main>
  );
}
