import fc from "fast-check";

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
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          whatItTests: { type: "string" },
          exampleInput: { type: "string" },
          expectedBehavior: { type: "string" },
          generator: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["integerRange", "decimalRange", "exampleOnly"] },
              field: { type: "string" },
              minimum: { type: ["number", "null"] },
              maximum: { type: ["number", "null"] },
              step: { type: ["number", "null"] },
              samples: { type: "integer", minimum: 0, maximum: 4 },
              validBehavior: { type: "string" },
              invalidBehavior: { type: "string" },
            },
            required: [
              "kind",
              "field",
              "minimum",
              "maximum",
              "step",
              "samples",
              "validBehavior",
              "invalidBehavior",
            ],
            additionalProperties: false,
          },
        },
        required: ["name", "whatItTests", "exampleInput", "expectedBehavior", "generator"],
        additionalProperties: false,
      },
    },
  },
  required: ["phase", "message", "questions", "title", "assumptions", "caseTypes"],
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
      result.caseTypes.length > 12 ||
      result.caseTypes.some(
        (item) =>
          !item ||
          typeof item.name !== "string" ||
          item.name.trim() === "" ||
          typeof item.whatItTests !== "string" ||
          item.whatItTests.trim() === "" ||
          typeof item.exampleInput !== "string" ||
          typeof item.expectedBehavior !== "string" ||
          item.expectedBehavior.trim() === "" ||
          !isValidGenerator(item.generator),
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

export function generateSyntheticCases(proposal) {
  if (
    !proposal ||
    typeof proposal.title !== "string" ||
    !Array.isArray(proposal.caseTypes) ||
    proposal.caseTypes.length === 0
  ) {
    throw new Error("The approved proposal has no boundary types to generate.");
  }

  const prefix =
    proposal.title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 3) || "EDL";

  const cases = proposal.caseTypes.flatMap((caseType) => {
    if (
      typeof caseType.name !== "string" ||
      typeof caseType.whatItTests !== "string" ||
      typeof caseType.exampleInput !== "string" ||
      typeof caseType.expectedBehavior !== "string" ||
      caseType.expectedBehavior.trim() === "" ||
      !isValidGenerator(caseType.generator)
    ) {
      throw new Error("Every proposed boundary type must include its example input and expected behavior.");
    }

    const example = parseExampleInput(caseType.exampleInput);
    const fields = Object.keys(example).join(", ") || "initiative input";
    const generator = caseType.generator;
    if (generator.kind === "exampleOnly") {
      return [
        makeCase(
          caseType,
          example,
          fields,
          caseType.expectedBehavior,
          "Approved example input.",
        ),
      ];
    }

    const { field, minimum, maximum, step, samples } = generator;
    const precision = Math.max(
      decimalPlaces(minimum),
      decimalPlaces(maximum),
      decimalPlaces(step),
      decimalPlaces(example[field]),
    );
    const scale = 10 ** precision;
    const minimumUnits = Math.round(minimum * scale);
    const maximumUnits = Math.round(maximum * scale);
    const stepUnits = Math.round(step * scale);
    if (
      !Object.hasOwn(example, field) ||
      typeof example[field] !== "number" ||
      precision > 8 ||
      Math.abs(example[field] * scale - Math.round(example[field] * scale)) > 1e-7 ||
      !Number.isSafeInteger(minimumUnits) ||
      !Number.isSafeInteger(maximumUnits) ||
      !Number.isSafeInteger(stepUnits) ||
      minimum > maximum ||
      stepUnits <= 0 ||
      (maximumUnits - minimumUnits) % stepUnits !== 0 ||
      (generator.kind === "integerRange" &&
        (!Number.isInteger(minimum) || !Number.isInteger(maximum) || step !== 1)) ||
      (generator.kind === "decimalRange" && step >= 1)
    ) {
      throw new Error(`Invalid numeric generator configuration for "${caseType.name}".`);
    }

    const variants = new Map();
    const addVariant = (units, label) => {
      const value = units / scale;
      if (!Number.isFinite(value) || !Number.isSafeInteger(units)) return;
      const current = variants.get(units);
      if (current) {
        if (!current.labels.includes(label)) current.labels.push(label);
      } else {
        variants.set(units, { value, labels: [label] });
      }
    };

    addVariant(minimumUnits - stepUnits, "just below minimum");
    addVariant(minimumUnits, "at minimum");
    addVariant(minimumUnits + stepUnits, "just above minimum");
    addVariant(maximumUnits - stepUnits, "just below maximum");
    addVariant(maximumUnits, "at maximum");
    addVariant(maximumUnits + stepUnits, "just above maximum");
    addVariant(Math.round(example[field] * scale), "approved example");

    const seed = stableSeed(`${proposal.title}:${caseType.name}:${field}`);
    const sampledUnits = fc.sample(
      fc.integer({
        min: 0,
        max: (maximumUnits - minimumUnits) / stepUnits,
      }),
      { seed, numRuns: samples },
    );
    sampledUnits.forEach((offset, index) =>
      addVariant(minimumUnits + offset * stepUnits, `reproducible sample ${index + 1}`),
    );

    return [...variants.values()].map(({ value, labels }) => {
      const input = { ...example, [field]: value };
      const inRange = value >= minimum && value <= maximum;
      const expectedBehavior = inRange ? generator.validBehavior : generator.invalidBehavior;
      return makeCase(
        caseType,
        input,
        fields,
        expectedBehavior,
        `${labels.join(" / ")}; allowed range is ${minimum} to ${maximum}.`,
      );
    });
  });

  return validateCases({
    cases: cases.map((boundaryCase, index) => ({
      ...boundaryCase,
      id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    })),
  });
}

function isValidGenerator(generator) {
  if (!generator || typeof generator !== "object") return false;
  if (!["integerRange", "decimalRange", "exampleOnly"].includes(generator.kind)) return false;
  if (
    typeof generator.field !== "string" ||
    !Number.isInteger(generator.samples) ||
    generator.samples < 0 ||
    generator.samples > 4 ||
    typeof generator.validBehavior !== "string" ||
    typeof generator.invalidBehavior !== "string"
  ) {
    return false;
  }
  if (generator.kind === "exampleOnly") {
    return (
      generator.field === "" &&
      generator.minimum === null &&
      generator.maximum === null &&
      generator.step === null &&
      generator.samples === 0 &&
      generator.validBehavior.trim() !== ""
    );
  }
  return (
    generator.field.trim() !== "" &&
    typeof generator.minimum === "number" &&
    Number.isFinite(generator.minimum) &&
    typeof generator.maximum === "number" &&
    Number.isFinite(generator.maximum) &&
    typeof generator.step === "number" &&
    Number.isFinite(generator.step) &&
    generator.step > 0 &&
    (generator.kind !== "decimalRange" || generator.step < 1) &&
    (generator.kind !== "integerRange" ||
      (Number.isInteger(generator.minimum) &&
        Number.isInteger(generator.maximum) &&
        generator.step === 1)) &&
    generator.validBehavior.trim() !== "" &&
    generator.invalidBehavior.trim() !== ""
  );
}

function parseExampleInput(value) {
  let input;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("Synthetic generator examples must be valid JSON objects.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Synthetic generator examples must be valid JSON objects.");
  }
  return input;
}

function decimalPlaces(value) {
  const text = String(value).toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const decimals = coefficient.includes(".") ? coefficient.length - coefficient.indexOf(".") - 1 : 0;
  return Math.max(0, decimals - Number(exponentText ?? 0));
}

function stableSeed(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeCase(caseType, input, fields, expectedBehavior, boundaryReason) {
  return {
    id: "",
    type: caseType.name,
    fields,
    input: JSON.stringify(input),
    why_boundary: `${caseType.whatItTests} ${boundaryReason}`,
    expected_behavior: expectedBehavior,
  };
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
