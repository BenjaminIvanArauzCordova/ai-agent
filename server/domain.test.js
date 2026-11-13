import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSyntheticCases,
  parseStructuredResponse,
  requestStructuredResponse,
  toCsv,
  toKebabCase,
  validateCases,
  validateConversationResult,
} from "./domain.js";

test("parses structured Copilot responses", () => {
  assert.deepEqual(parseStructuredResponse({ data: { content: '{"cases":[]}' } }), {
    cases: [],
  });
  assert.deepEqual(parseStructuredResponse({ cases: [] }), { cases: [] });
  assert.throws(() => parseStructuredResponse({ data: { content: "not JSON" } }), /valid JSON/);
});

test("retries a missing structured response as JSON text", async () => {
  const prompts = [];
  const session = {
    async sendAndWait(options) {
      prompts.push(options);
      return prompts.length === 1
        ? undefined
        : { data: { content: '{"cases":[]}' } };
    },
  };
  const schema = { type: "object", properties: { cases: { type: "array" } } };

  assert.deepEqual(
    await requestStructuredResponse(session, "Generate cases.", schema, 1000),
    { cases: [] },
  );
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].responseSchema, schema);
  assert.match(prompts[1].prompt, /exactly one JSON object/);
});

test("reports a useful error when structured output and retry both fail", async () => {
  const session = { async sendAndWait() { return undefined; } };
  await assert.rejects(
    requestStructuredResponse(session, "Generate cases.", {}, 1000),
    /JSON retry failed/,
  );
});

test("does not retry unrelated Copilot errors", async () => {
  let calls = 0;
  const session = {
    async sendAndWait() {
      calls += 1;
      throw new Error("Copilot is unavailable.");
    },
  };
  await assert.rejects(
    requestStructuredResponse(session, "Generate cases.", {}, 1000),
    /Copilot is unavailable/,
  );
  assert.equal(calls, 1);
});

test("requires unique case IDs and expected behavior", () => {
  const validCase = {
    id: "EXP-001",
    type: "amount",
    fields: "amount",
    input: '{"amount":0}',
    why_boundary: "Tests zero",
    expected_behavior: "Reject the amount.",
  };
  assert.deepEqual(validateCases({ cases: [validCase] }), [validCase]);
  assert.throws(() => validateCases({ cases: [{ ...validCase, expected_behavior: "" }] }), /expected behavior/);
  assert.throws(() => validateCases({ cases: [validCase, validCase] }), /duplicate case ID/);
});

test("generates stable synthetic cases locally from an approved proposal", () => {
  const proposal = {
    title: "Mobile Expense Tracker",
    caseTypes: [
      {
        name: "zero amount",
        whatItTests: "Minimum amount boundary",
        exampleInput: '{"amount":0,"currency":"USD"}',
        expectedBehavior: "Reject zero as an expense.",
        generator: {
          kind: "integerRange",
          field: "amount",
          minimum: 1,
          maximum: 12,
          step: 1,
          samples: 2,
          validBehavior: "Accept the amount.",
          invalidBehavior: "Reject the amount.",
        },
      },
      {
        name: "unicode category",
        whatItTests: "Unicode handling",
        exampleInput: '{"category":"🍜 東京"}',
        expectedBehavior: "Preserve the category text.",
        generator: {
          kind: "exampleOnly",
          field: "",
          minimum: null,
          maximum: null,
          step: null,
          samples: 0,
          validBehavior: "Preserve the category text.",
          invalidBehavior: "",
        },
      },
    ],
  };

  const cases = generateSyntheticCases(proposal);
  assert.deepEqual(cases, generateSyntheticCases(proposal));
  assert.deepEqual(
    cases.slice(0, 6).map(({ input }) => JSON.parse(input).amount),
    [0, 1, 2, 11, 12, 13],
  );
  assert.deepEqual(
    cases.map((item) => item.id),
    cases.map((_, index) => `MOB-${String(index + 1).padStart(3, "0")}`),
  );
  assert.equal(cases[0].fields, "amount, currency");
  assert.equal(cases[0].expected_behavior, "Reject the amount.");
  assert.equal(cases[1].expected_behavior, "Accept the amount.");
  assert.equal(cases[5].expected_behavior, "Reject the amount.");
  assert.equal(cases.find((item) => JSON.parse(item.input).category)?.fields, "category");
  assert.equal(cases.find((item) => JSON.parse(item.input).category)?.input, '{"category":"🍜 東京"}');
  assert.match(cases.find((item) => item.why_boundary.includes("reproducible sample"))?.why_boundary, /reproducible sample/);
});

test("does not generate approved examples without expected behavior", () => {
  assert.throws(
    () =>
      generateSyntheticCases({
        title: "Expense Tracker",
        caseTypes: [
          {
            name: "amount",
            whatItTests: "Amount limit",
            exampleInput: '{"amount":0}',
            expectedBehavior: "",
            generator: {
              kind: "exampleOnly",
              field: "",
              minimum: null,
              maximum: null,
              step: null,
              samples: 0,
              validBehavior: "",
              invalidBehavior: "",
            },
          },
        ],
      }),
    /expected behavior/,
  );
});

test("requires explicit, valid generator metadata in proposals", () => {
  const proposal = {
    phase: "proposal",
    message: "Review these cases.",
    questions: [],
    title: "Reservation API",
    assumptions: [],
    caseTypes: [
      {
        name: "party size",
        whatItTests: "Inclusive party-size limits",
        exampleInput: '{"partySize":1}',
        expectedBehavior: "Accept party size within the supported range.",
        generator: {
          kind: "integerRange",
          field: "partySize",
          minimum: 1,
          maximum: 12,
          step: 1,
          samples: 2,
          validBehavior: "Accept party size within the supported range.",
          invalidBehavior: "Reject party size outside the supported range.",
        },
      },
    ],
  };
  assert.equal(validateConversationResult(proposal), proposal);
  assert.throws(
    () =>
      validateConversationResult({
        ...proposal,
        caseTypes: [
          {
            ...proposal.caseTypes[0],
            generator: { ...proposal.caseTypes[0].generator, step: 0 },
          },
        ],
      }),
    /incomplete proposal/,
  );
});

test("generates exact decimal boundaries and keeps sampled values in range", () => {
  const proposal = {
    title: "Expense Tracker",
    caseTypes: [
      {
        name: "amount precision",
        whatItTests: "Currency precision around the supported minimum",
        exampleInput: '{"amount":0.1,"currency":"USD"}',
        expectedBehavior: "Reject values below minimum.",
        generator: {
          kind: "decimalRange",
          field: "amount",
          minimum: 0.1,
          maximum: 0.3,
          step: 0.01,
          samples: 2,
          validBehavior: "Accept values in range.",
          invalidBehavior: "Reject values outside range.",
        },
      },
    ],
  };
  const cases = generateSyntheticCases(proposal);
  const amounts = cases.map((item) => JSON.parse(item.input).amount);
  assert.ok(amounts.includes(0.09));
  assert.ok(amounts.includes(0.1));
  assert.ok(amounts.includes(0.11));
  assert.ok(amounts.includes(0.29));
  assert.ok(amounts.includes(0.3));
  assert.ok(amounts.includes(0.31));
  for (const boundaryCase of cases) {
    const amount = JSON.parse(boundaryCase.input).amount;
    assert.equal(
      boundaryCase.expected_behavior,
      amount >= 0.1 && amount <= 0.3
        ? "Accept values in range."
        : "Reject values outside range.",
    );
  }
});

test("escapes all CSV cells and sanitizes output filenames", () => {
  const csv = toCsv([
    {
      id: "EXP-001",
      type: "amount",
      fields: "amount",
      input: '{"note":"a,b"}',
      why_boundary: "Contains a comma, and a quote: \"",
      expected_behavior: "Keep it.\nDo not normalize.",
    },
  ]);
  assert.match(csv, /"Contains a comma, and a quote: """/);
  assert.match(csv, /"Keep it\.\nDo not normalize\."/);
  assert.equal(toKebabCase("Mobile Expense Tracker"), "mobile-expense-tracker");
  assert.equal(toKebabCase("../../"), "boundary-cases");
});
