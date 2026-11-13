export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    phase: { type: "string", enum: ["questions", "proposal"] },
    message: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    caseTypes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          whatItTests: { type: "string" },
          exampleInput: { type: "string" },
        },
        required: ["name", "whatItTests", "exampleInput"],
        additionalProperties: false,
      },
    },
  },
  required: ["phase", "message", "questions", "title", "assumptions", "caseTypes"],
  additionalProperties: false,
};

export const CASES_SCHEMA = {
  type: "object",
  properties: {
    cases: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          fields: { type: "string" },
          input: { type: "string" },
          why_boundary: { type: "string" },
          expected_behavior: { type: "string" },
        },
        required: ["id", "type", "fields", "input", "why_boundary", "expected_behavior"],
        additionalProperties: false,
      },
    },
  },
  required: ["cases"],
  additionalProperties: false,
};

export const CSV_COLUMNS = [
  "id",
  "type",
  "fields",
  "input",
  "why_boundary",
  "expected_behavior",
];

export class MissingStructuredResponseError extends Error {
  constructor() {
    super("Copilot completed the turn without returning structured JSON.");
    this.name = "MissingStructuredResponseError";
  }
}

export function parseStructuredResponse(response) {
  if (response && typeof response === "object" && !("data" in response)) {
    return response;
  }

  const content = response?.data?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new MissingStructuredResponseError();
  }

  let value;
  try {
    const json = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
    value = JSON.parse(json);
  } catch {
    throw new Error("Copilot returned a response that was not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Copilot returned an invalid response.");
  }
  return value;
}

export async function requestStructuredResponse(session, prompt, schema, timeout) {
  let structuredError;
  try {
    const response = await session.sendAndWait(
      { prompt, responseSchema: schema },
      timeout,
    );
    return parseStructuredResponse(response);
  } catch (error) {
    if (!(error instanceof MissingStructuredResponseError)) {
      throw error;
    }
    structuredError = error;
  }

  try {
    const retryPrompt = `${prompt}

The previous turn did not provide usable structured output. Retry once and respond with exactly one JSON object matching this JSON Schema. Do not include prose or Markdown:
${JSON.stringify(schema)}`;
    const response = await session.sendAndWait({ prompt: retryPrompt }, timeout);
    return parseStructuredResponse(response);
  } catch (retryError) {
    const reason = retryError instanceof Error ? retryError.message : String(retryError);
    const error = new Error(
      `Copilot returned no structured output (${structuredError.message}); JSON retry failed: ${reason}`,
      {
        cause: retryError,
      },
    );
    throw error;
  }
}

export function validateConversationResult(result) {
  if (
    !["questions", "proposal"].includes(result.phase) ||
    typeof result.message !== "string" ||
    result.message.trim() === "" ||
    !Array.isArray(result.questions) ||
    !Array.isArray(result.assumptions) ||
    !Array.isArray(result.caseTypes) ||
    result.questions.some((item) => typeof item !== "string") ||
    result.assumptions.some((item) => typeof item !== "string")
  ) {
    throw new Error("Copilot returned an incomplete proposal.");
  }
  if (result.phase === "questions" && (result.questions.length === 0 || result.questions.length > 4)) {
    throw new Error("Copilot returned an invalid set of questions.");
  }
  if (
    result.phase === "proposal" &&
    (typeof result.title !== "string" ||
      result.caseTypes.length === 0 ||
      result.caseTypes.some(
        (item) =>
          !item ||
          typeof item.name !== "string" ||
          typeof item.whatItTests !== "string" ||
          typeof item.exampleInput !== "string",
      ))
  ) {
    throw new Error("Copilot returned an incomplete proposal.");
  }
  return result;
}

export function validateCases(value) {
  if (!value || !Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > 200) {
    throw new Error("Copilot returned an invalid number of cases.");
  }

  const seenIds = new Set();
  for (const boundaryCase of value.cases) {
    if (
      !boundaryCase ||
      CSV_COLUMNS.some(
        (column) => typeof boundaryCase[column] !== "string",
      ) ||
      boundaryCase.id.trim() === "" ||
      boundaryCase.expected_behavior.trim() === ""
    ) {
      throw new Error("Every generated case must include all CSV fields and expected behavior.");
    }
    if (seenIds.has(boundaryCase.id)) {
      throw new Error(`Copilot returned a duplicate case ID: ${boundaryCase.id}`);
    }
    seenIds.add(boundaryCase.id);
  }
  return value.cases;
}

export function toCsv(cases) {
  const escape = (value) => `"${value.replaceAll('"', '""')}"`;
  return [
    CSV_COLUMNS.map(escape).join(","),
    ...cases.map((boundaryCase) => CSV_COLUMNS.map((column) => escape(boundaryCase[column])).join(",")),
  ].join("\r\n");
}

export function toKebabCase(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return slug || "boundary-cases";
}
