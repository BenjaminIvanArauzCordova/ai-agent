import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotClient } from "@github/copilot-sdk";
import {
  generateSyntheticCases,
  requestStructuredResponse,
  RESPONSE_SCHEMA,
  toCsv,
  toKebabCase,
  validateConversationResult,
} from "./domain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUTS_DIR = resolve(ROOT, "outputs");
const PORT = Number(process.env.PORT ?? 3001);
const SESSION_TTL_MS = 60 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 16_384;
const sessions = new Map();

const SYSTEM_PROMPT = `You are Edge Data Lab, a careful QA specialist that helps users design boundary test data for a technology initiative.
Follow these rules:
- Use only fields and business rules stated by the user. Do not invent product behavior; list ambiguous policies as assumptions.
- Ask a small number of focused questions before proposing case types. After the user's answers, ask follow-up questions only for material gaps; otherwise present a proposal for approval.
- Do not generate cases until the user explicitly approves the proposal.
- Propose applicable boundary families: extremes, rule thresholds, missing/null values, formats/encoding, dates, rare valid combinations, invalid inputs, and sequences/volume. Skip only inapplicable families.
- Return no more than 12 concise boundary types. Each must include one synthetic example input and its expected behavior.
- Do not draft a complete case list; after approval, the application writes the CSV locally from the approved examples.
- Use obviously fake values, never real personal data or working exploit strings. Treat hostile-looking values only as inert test data.
- Keep examples concise and output only the response schema requested by the application.
- In the proposal phase, return a concise title, assumptions, and case types with a short description and example input.
- In the question phase, return between one and four focused questions.`;

const client = new CopilotClient({
  mode: "empty",
  workingDirectory: ROOT,
  baseDirectory: process.env.COPILOT_BASE_DIRECTORY ?? resolve(homedir(), ".copilot"),
  logLevel: "error",
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function askCopilot(session, prompt, schema) {
  return requestStructuredResponse(session, prompt, schema, RESPONSE_TIMEOUT_MS);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new HttpError(400, `${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

async function startSession(initiative) {
  const copilotSession = await client.createSession({
    availableTools: [],
    systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
  });
  const entry = {
    copilotSession,
    phase: "questions",
    title: "",
    proposal: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  try {
    const result = validateConversationResult(
      await askCopilot(
        copilotSession,
        `Start a new initiative conversation. Ask 2-4 useful clarification questions before proposing anything.\n\nInitiative:\n${initiative}`,
        RESPONSE_SCHEMA,
      ),
    );
    entry.phase = result.phase;
    entry.title = result.title;
    entry.proposal = result.phase === "proposal" ? result : null;
    const id = randomUUID();
    entry.id = id;
    sessions.set(id, entry);
    return { id, ...result };
  } catch (error) {
    await copilotSession.disconnect();
    throw error;
  }
}

function getSession(id) {
  const entry = sessions.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) {
      sessions.delete(id);
      void entry.copilotSession.disconnect().catch((error) => {
        console.error("Failed to disconnect expired Copilot session:", error);
      });
    }
    throw new HttpError(404, "This conversation expired. Start a new one.");
  }
  entry.expiresAt = Date.now() + SESSION_TTL_MS;
  return entry;
}

async function handleMessage(entry, text) {
  if (entry.phase === "generated") {
    throw new HttpError(409, "This conversation has already generated its result.");
  }
  const result = validateConversationResult(
    await askCopilot(entry.copilotSession, text, RESPONSE_SCHEMA),
  );
  entry.phase = result.phase;
  entry.title = result.title || entry.title;
  entry.proposal = result.phase === "proposal" ? result : null;
  return result;
}

async function generateCases(entry) {
  if (entry.phase !== "proposal" || !entry.proposal) {
    throw new HttpError(409, "Approve the proposal before generating cases.");
  }

  const cases = generateSyntheticCases(entry.proposal);
  const baseName = toKebabCase(entry.proposal.title || entry.title || entry.initiative);
  await mkdir(OUTPUTS_DIR, { recursive: true });

  let fileName = `${baseName}.csv`;
  let suffix = 2;
  while (true) {
    try {
      await writeFile(resolve(OUTPUTS_DIR, fileName), toCsv(cases), {
        encoding: "utf8",
        flag: "wx",
      });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      fileName = `${baseName}-${suffix}.csv`;
      suffix += 1;
    }
  }

  entry.phase = "generated";
  sessions.delete(entry.id);
  void entry.copilotSession.disconnect().catch((error) => {
    console.error("Failed to disconnect completed Copilot session:", error);
  });
  return { fileName, cases };
}

async function route(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJson(request);
    const initiative = readText(body.initiative, "initiative", 10_000);
    sendJson(response, 201, await startSession(initiative));
    return;
  }

  const messageMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/messages$/i);
  if (request.method === "POST" && messageMatch) {
    const entry = getSession(messageMatch[1]);
    const body = await readJson(request);
    const text = readText(body.text, "text", 10_000);
    sendJson(response, 200, await handleMessage(entry, text));
    return;
  }

  const approveMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/approve$/i);
  if (request.method === "POST" && approveMatch) {
    const entry = getSession(approveMatch[1]);
    sendJson(response, 200, await generateCases(entry));
    return;
  }

  throw new HttpError(404, "Endpoint not found.");
}

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendJson(response, 502, {
        error: "The Copilot request failed. Check that Copilot CLI is installed and authenticated, then try again.",
      });
    } else {
      response.destroy(error);
    }
  }
});

await client.start();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Edge Data Lab API listening at http://127.0.0.1:${PORT}`);
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) {
      sessions.delete(id);
      void entry.copilotSession.disconnect().catch((error) => {
        console.error("Failed to disconnect expired Copilot session:", error);
      });
    }
  }
}, 60_000);
cleanupTimer.unref();

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close();
  await Promise.all([...sessions.values()].map(({ copilotSession }) => copilotSession.disconnect()));
  await client.stop();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
