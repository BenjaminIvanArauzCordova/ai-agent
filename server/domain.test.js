import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSyntheticCases,
  parseStructuredResponse,
  requestStructuredResponse,
  toCsv,
  toKebabCase,
  validateCases,
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
      },
      {
        name: "unicode category",
        whatItTests: "Unicode handling",
        exampleInput: '{"category":"🍜 東京"}',
        expectedBehavior: "Preserve the category text.",
      },
    ],
  };

  const cases = generateSyntheticCases(proposal);
  assert.deepEqual(cases, generateSyntheticCases(proposal));
  assert.deepEqual(cases.map((item) => item.id), ["MOB-001", "MOB-002"]);
  assert.equal(cases[0].fields, "amount, currency");
  assert.equal(cases[0].input, proposal.caseTypes[0].exampleInput);
  assert.equal(cases[0].expected_behavior, "Reject zero as an expense.");
  assert.equal(cases[1].fields, "category");
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
          },
        ],
      }),
    /expected behavior/,
  );
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
