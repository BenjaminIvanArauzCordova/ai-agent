import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
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
const exampleInitiative =
  "Restaurant reservation API. Fields: party size (1 to 12), date and time, and restaurant time zone. The restaurant is open from 12:00 to 23:00. Reservations cannot be made in the past.";

interface ConversationResult {
  id?: string;
  phase: "questions" | "proposal";
  message: string;
  questions: string[];
  title: string;
  assumptions: string[];
  caseTypes: {
    name: string;
    whatItTests: string;
    exampleInput: string;
    expectedBehavior: string;
    generator: {
      kind: "integerRange" | "decimalRange" | "exampleOnly";
      field: string;
      minimum: number | null;
      maximum: number | null;
      step: number | null;
      samples: number;
      validBehavior: string;
      invalidBehavior: string;
    };
  }[];
}

interface ChatMessage {
  role: "user" | "assistant";
  message: string;
  questions?: string[];
}

async function postJson<T extends object>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error("error" in result && result.error ? result.error : "The request failed.");
  }
  return result as T;
}

export default function App() {
  const [cases, setCases] = useState<BoundaryCase[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [initiative, setInitiative] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [stage, setStage] = useState<"idle" | "questions" | "proposal" | "generated">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [proposal, setProposal] = useState<ConversationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"starting" | "responding" | "generating" | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [policyOnly, setPolicyOnly] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const responseInputRef = useRef<HTMLTextAreaElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

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

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (stage !== "generated") return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    document.getElementById("results")?.scrollIntoView({ behavior, block: "start" });
    resultsHeadingRef.current?.focus({ preventScroll: true });
  }, [stage]);

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

  const startConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = initiative.trim();
    if (!text || busy) return;

    setError("");
    setBusy(true);
    setBusyAction("starting");
    setMessages([{ role: "user", message: text }]);
    setProposal(null);
    setSessionId("");
    setCases([]);
    setFileName("");
    clearFilters();
    try {
      const result = await postJson<ConversationResult & { id: string }>("/api/sessions", {
        initiative: text,
      });
      setSessionId(result.id);
      setStage(result.phase);
      setProposal(result.phase === "proposal" ? result : null);
      setMessages((current) => [
        ...current,
        { role: "assistant", message: result.message, questions: result.questions },
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start the conversation.");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !sessionId || busy) return;

    setError("");
    setBusy(true);
    setBusyAction("responding");
    const userMessage: ChatMessage = { role: "user", message: text };
    setMessages((current) => [...current, userMessage]);
    try {
      const result = await postJson<ConversationResult>(
        `/api/sessions/${sessionId}/messages`,
        { text },
      );
      setStage(result.phase);
      setProposal(result.phase === "proposal" ? result : null);
      setMessages((current) => [
        ...current,
        { role: "assistant", message: result.message, questions: result.questions },
      ]);
      setChatText("");
      responseInputRef.current?.focus();
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message !== userMessage));
      setError(requestError instanceof Error ? requestError.message : "Could not send your message.");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const approveProposal = async () => {
    if (!sessionId || busy) return;
    setError("");
    setBusy(true);
    setBusyAction("generating");
    try {
      const result = await postJson<{ fileName: string; cases: BoundaryCase[] }>(
        `/api/sessions/${sessionId}/approve`,
      );
      clearFilters();
      setCases(result.cases);
      setFileName(result.fileName);
      setStage("generated");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          message: `Generated ${result.cases.length} boundary cases and saved ${result.fileName}. The full result is shown below.`,
        },
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not generate the cases.");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const startOver = () => {
    setStage("idle");
    setMessages([]);
    setProposal(null);
    setSessionId("");
    setInitiative("");
    setChatText("");
    setError("");
    setCases([]);
    setFileName("");
    clearFilters();
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
  const downloadGeneratedCsv = () =>
    downloadText(fileName || "boundary-cases.csv", toCsv(cases), "text/csv");

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

      <section className="chat-panel" aria-labelledby="chat-title" aria-busy={busy}>
        <div className="chat-heading">
          <div>
            <h2 id="chat-title">Generate boundary cases</h2>
            <p>Describe your initiative. Copilot will clarify details, propose a plan, then generate the CSV.</p>
          </div>
          {stage !== "idle" && <button className="ghost start-over" type="button" onClick={startOver} disabled={busy}>Start over</button>}
        </div>

        <ol className="workflow-steps" aria-label="Generation steps">
          {[
            { label: "Describe", active: stage === "idle" },
            { label: "Clarify", active: stage === "questions" },
            { label: "Review", active: stage === "proposal" },
            { label: "Results", active: stage === "generated" },
          ].map((step, index) => {
            const currentIndex = stage === "idle" ? 0 : stage === "questions" ? 1 : stage === "proposal" ? 2 : 3;
            return (
              <li
                className={index < currentIndex ? "complete" : ""}
                aria-current={step.active ? "step" : undefined}
                key={step.label}
              >
                <span className="step-number">{index < currentIndex ? "✓" : index + 1}</span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>

        {messages.length > 0 && (
          <div className="chat-messages" ref={messagesRef} aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                <strong>{message.role === "user" ? "You" : "Edge Data Lab"}</strong>
                <p>{message.message}</p>
                {message.questions && message.questions.length > 0 && (
                  <ol>
                    {message.questions.map((question) => <li key={question}>{question}</li>)}
                  </ol>
                )}
              </article>
            ))}
            {busy && (
              <p className="working-indicator" role="status">
                <span className="spinner" aria-hidden="true" />
                {busyAction === "starting" && "Reading your initiative…"}
                {busyAction === "responding" && "Thinking about your answers…"}
                {busyAction === "generating" && "Generating and checking the cases…"}
              </p>
            )}
          </div>
        )}

        {stage === "idle" && (
          <form className="chat-form" onSubmit={startConversation}>
            <label htmlFor="initiative">What are you building?</label>
            <p className="field-hint">Include the main fields, rules, and any limits you already know.</p>
            <textarea
              id="initiative"
              value={initiative}
              onChange={(event) => setInitiative(event.target.value)}
              placeholder="Describe your initiative and its important rules…"
              maxLength={10_000}
              required
              rows={4}
              disabled={busy}
            />
            <div className="form-actions">
              <span className="character-count">{initiative.length.toLocaleString()} / 10,000</span>
              <button type="submit" disabled={busy || initiative.trim() === ""}>
                {busy ? "Starting…" : "Start with Copilot"}
              </button>
            </div>
            <button
              className="example-button"
              type="button"
              onClick={() => setInitiative(exampleInitiative)}
              disabled={busy}
            >
              Try an example: restaurant reservations
            </button>
          </form>
        )}

        {(stage === "questions" || stage === "proposal") && (
          <>
            {stage === "proposal" && proposal && (
              <div className="proposal">
                <h3>{proposal.title}</h3>
                {proposal.assumptions.length > 0 && (
                  <>
                    <h4>Assumptions to confirm</h4>
                    <ul>{proposal.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                )}
                <h4>Proposed boundary types</h4>
                <ul className="proposal-types">
                  {proposal.caseTypes.map((item) => (
                    <li key={item.name}>
                      <strong>{item.name}</strong>
                      <span>{item.whatItTests}</span>
                      <code>{item.exampleInput}</code>
                      {item.generator.kind === "exampleOnly" ? (
                        <span className="proposal-expected"><strong>Expected:</strong> {item.expectedBehavior}</span>
                      ) : (
                        <>
                          <span className="proposal-expected">
                            <strong>Generated:</strong> {item.generator.field} at and around {item.generator.minimum}–{item.generator.maximum}, plus up to {item.generator.samples} reproducible in-range samples.
                          </span>
                          <span className="proposal-expected"><strong>In range:</strong> {item.generator.validBehavior}</span>
                          <span className="proposal-expected"><strong>Out of range:</strong> {item.generator.invalidBehavior}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={approveProposal} disabled={busy}>
                  {busy ? "Generating…" : `Approve and generate ${proposal.caseTypes.length} types`}
                </button>
              </div>
            )}
            <form className="chat-form answer-form" onSubmit={sendMessage}>
              <label htmlFor="chat-response">
                {stage === "questions" ? "Your answers" : "Request a change to the proposal (optional)"}
              </label>
              {stage === "questions" && <p className="field-hint">Answer what you can; mention “not sure” for anything undecided.</p>}
              <textarea
                ref={responseInputRef}
                id="chat-response"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder={stage === "questions" ? "Answer the questions above…" : "Tell Copilot what to adjust…"}
                maxLength={10_000}
                rows={3}
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="form-actions">
                <span className="field-hint">Press Ctrl+Enter to send</span>
                <button type="submit" disabled={busy || chatText.trim() === ""}>
                  {busy ? "Sending…" : stage === "questions" ? "Send answers" : "Update proposal"}
                </button>
              </div>
            </form>
          </>
        )}

        {stage === "generated" && (
          <div className="completion-card">
            <span className="completion-check" aria-hidden="true">✓</span>
            <div>
              <h3>Your boundary cases are ready</h3>
              <p>{cases.length} cases saved to <strong>{fileName}</strong> and loaded into the results table.</p>
            </div>
            <button type="button" onClick={downloadGeneratedCsv}>Download CSV</button>
          </div>
        )}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!hasData && <DropZone onFile={handleFile} />}

      {hasData && (
        <>
          <section id="results" className="results-section" aria-labelledby="results-title">
            <div className="results-heading">
              <div>
                <h2 id="results-title" ref={resultsHeadingRef} tabIndex={-1}>Boundary case results</h2>
                <p>{cases.length} cases across {counts.length} types · {fileName}</p>
              </div>
              {stage === "generated" && <button className="ghost" type="button" onClick={downloadGeneratedCsv}>Download full CSV</button>}
            </div>
          </section>
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
