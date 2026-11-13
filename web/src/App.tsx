import { useMemo, useState } from "react";
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

interface ConversationResult {
  id?: string;
  phase: "questions" | "proposal";
  message: string;
  questions: string[];
  title: string;
  assumptions: string[];
  caseTypes: { name: string; whatItTests: string; exampleInput: string }[];
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

  const startConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = initiative.trim();
    if (!text || busy) return;

    setError("");
    setBusy(true);
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
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !sessionId || busy) return;

    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", message: text }]);
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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not send your message.");
    } finally {
      setBusy(false);
    }
  };

  const approveProposal = async () => {
    if (!sessionId || busy) return;
    setError("");
    setBusy(true);
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
    }
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

      <section className="chat-panel" aria-labelledby="chat-title">
        <div className="chat-heading">
          <div>
            <h2 id="chat-title">Generate boundary cases</h2>
            <p>Describe your initiative. Copilot will clarify details, propose a plan, then generate the CSV.</p>
          </div>
          {stage !== "idle" && (
            <span className="chat-stage">
              {stage === "questions" && "Clarifying"}
              {stage === "proposal" && "Review proposal"}
              {stage === "generated" && "Complete"}
            </span>
          )}
        </div>

        {messages.length > 0 && (
          <div className="chat-messages" aria-live="polite">
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
          </div>
        )}

        {stage === "idle" && (
          <form className="chat-form" onSubmit={startConversation}>
            <label htmlFor="initiative">Technology initiative</label>
            <textarea
              id="initiative"
              value={initiative}
              onChange={(event) => setInitiative(event.target.value)}
              placeholder="What are you building, and what should it do?"
              maxLength={10_000}
              required
              rows={4}
            />
            <button type="submit" disabled={busy || initiative.trim() === ""}>
              {busy ? "Starting conversation…" : "Start"}
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
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={approveProposal} disabled={busy}>
                  {busy ? "Generating cases…" : "Approve and generate"}
                </button>
              </div>
            )}
            <form className="chat-form answer-form" onSubmit={sendMessage}>
              <label htmlFor="chat-response">
                {stage === "questions" ? "Your answers" : "Request a change to the proposal (optional)"}
              </label>
              <textarea
                id="chat-response"
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                placeholder={stage === "questions" ? "Answer the questions above…" : "Tell Copilot what to adjust…"}
                maxLength={10_000}
                rows={3}
              />
              <button type="submit" disabled={busy || chatText.trim() === ""}>
                {busy ? "Thinking…" : stage === "questions" ? "Send answers" : "Update proposal"}
              </button>
            </form>
          </>
        )}

        {stage === "generated" && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setStage("idle");
              setMessages([]);
              setProposal(null);
              setSessionId("");
              setInitiative("");
              setError("");
            }}
          >
            Start a new initiative
          </button>
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
