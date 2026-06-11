import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runHeuristicReview } from "../src/heuristics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "llm");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

const ALL_LLM_TITLES = [
  "Untrusted input interpolated into prompt",
  "Model output passed to code execution",
  "Model output rendered as unsanitized HTML",
  "Unvalidated tool-call arguments",
  "Hardcoded LLM API key",
  "LLM prompt/response logged",
  "Model safety/moderation disabled",
  "Secret or PII included in prompt",
  "Authorization decision based on model output",
  "Untrusted external content fed into prompt"
] as const;

type LlmTitle = (typeof ALL_LLM_TITLES)[number];

interface FixtureCase {
  fixture: string;
  title: LlmTitle;
  severity: "critical" | "high" | "medium" | "low" | "info";
  expectedFile: string;
}

const FIXTURE_CASES: FixtureCase[] = [
  {
    fixture: "prompt-interpolation.diff",
    title: "Untrusted input interpolated into prompt",
    severity: "medium",
    expectedFile: "src/chat/buildPrompt.ts"
  },
  {
    fixture: "output-to-eval.diff",
    title: "Model output passed to code execution",
    severity: "critical",
    expectedFile: "src/agent/executor.ts"
  },
  {
    fixture: "output-to-html.diff",
    title: "Model output rendered as unsanitized HTML",
    severity: "high",
    expectedFile: "src/components/AiReply.tsx"
  },
  {
    fixture: "tool-args.diff",
    title: "Unvalidated tool-call arguments",
    severity: "medium",
    expectedFile: "src/tools/callHandler.ts"
  },
  {
    fixture: "hardcoded-key.diff",
    title: "Hardcoded LLM API key",
    severity: "high",
    expectedFile: "src/lib/openai.ts"
  },
  {
    fixture: "prompt-logged.diff",
    title: "LLM prompt/response logged",
    severity: "low",
    expectedFile: "src/chat/logger.ts"
  },
  {
    fixture: "moderation-off.diff",
    title: "Model safety/moderation disabled",
    severity: "medium",
    expectedFile: "src/lib/gemini.ts"
  },
  {
    fixture: "pii-in-prompt.diff",
    title: "Secret or PII included in prompt",
    severity: "high",
    expectedFile: "src/support/summarize.ts"
  },
  {
    fixture: "authz-from-model.diff",
    title: "Authorization decision based on model output",
    severity: "medium",
    expectedFile: "src/auth/gatekeeper.ts"
  },
  {
    fixture: "external-into-prompt.diff",
    title: "Untrusted external content fed into prompt",
    severity: "medium",
    expectedFile: "src/rag/webFetcher.ts"
  }
];

describe("LLM heuristics — vulnerable fixtures (per-class)", () => {
  it("prompt-interpolation.diff: flags untrusted input in prompt as medium", () => {
    const diff = readFixture("prompt-interpolation.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Untrusted input interpolated into prompt"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/chat/buildPrompt.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("output-to-eval.diff: flags model output to execSync as critical", () => {
    const diff = readFixture("output-to-eval.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Model output passed to code execution"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.file).toBe("src/agent/executor.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("output-to-html.diff: flags dangerouslySetInnerHTML with completion as high", () => {
    const diff = readFixture("output-to-html.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Model output rendered as unsanitized HTML"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/components/AiReply.tsx");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("tool-args.diff: flags unvalidated tool-call arguments as medium", () => {
    const diff = readFixture("tool-args.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Unvalidated tool-call arguments"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/tools/callHandler.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("hardcoded-key.diff: flags inline sk- API key as high", () => {
    const diff = readFixture("hardcoded-key.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Hardcoded LLM API key");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/lib/openai.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("prompt-logged.diff: flags prompt/response logging as low", () => {
    const diff = readFixture("prompt-logged.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "LLM prompt/response logged");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.file).toBe("src/chat/logger.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("moderation-off.diff: flags BLOCK_NONE safety setting as medium", () => {
    const diff = readFixture("moderation-off.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Model safety/moderation disabled"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/lib/gemini.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("pii-in-prompt.diff: flags SSN in prompt as high", () => {
    const diff = readFixture("pii-in-prompt.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find((f) => f.title === "Secret or PII included in prompt");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.file).toBe("src/support/summarize.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("authz-from-model.diff: flags authorization based on model output as medium", () => {
    const diff = readFixture("authz-from-model.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Authorization decision based on model output"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/auth/gatekeeper.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });

  it("external-into-prompt.diff: flags fetched HTML fed into prompt as medium", () => {
    const diff = readFixture("external-into-prompt.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const finding = result.findings.find(
      (f) => f.title === "Untrusted external content fed into prompt"
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.file).toBe("src/rag/webFetcher.ts");
    expect(finding!.line).toBeGreaterThan(0);
  });
});

describe("LLM heuristics — fixture table (file and line set)", () => {
  for (const { fixture, title, severity, expectedFile } of FIXTURE_CASES) {
    it(`${fixture} produces a ${severity} finding titled "${title}"`, () => {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const finding = result.findings.find((f) => f.title === title);
      expect(finding, `Expected finding "${title}" in ${fixture}`).toBeDefined();
      expect(finding!.severity).toBe(severity);
      expect(finding!.file).toBe(expectedFile);
      expect(finding!.line).toBeDefined();
      expect(typeof finding!.line).toBe("number");
    });
  }
});

describe("LLM heuristics — clean fixture", () => {
  it("clean-llm.diff: yields none of the 10 LLM heuristic findings", () => {
    const diff = readFixture("clean-llm.diff");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const llmFindings = result.findings.filter((f) =>
      (ALL_LLM_TITLES as readonly string[]).includes(f.title)
    );
    expect(llmFindings).toHaveLength(0);
  });
});

describe("LLM heuristics — non-LLM diff does not fire LLM checks", () => {
  it("a plain Terraform diff does not produce any LLM heuristic findings", () => {
    const diff = [
      "diff --git a/infra/main.tf b/infra/main.tf",
      "--- a/infra/main.tf",
      "+++ b/infra/main.tf",
      "@@ -1,3 +1,6 @@",
      '+resource "aws_instance" "web" {',
      '+  ami           = "ami-0c02fb55956c7d316"',
      '+  instance_type = "t3.micro"',
      "+}"
    ].join("\n");
    const result = runHeuristicReview({ mode: "review", subject: "t", diff });
    const llmFindings = result.findings.filter((f) =>
      (ALL_LLM_TITLES as readonly string[]).includes(f.title)
    );
    expect(llmFindings).toHaveLength(0);
  });
});

describe("LLM heuristics — KPI: >= 10 distinct vulnerability classes", () => {
  it("all 10 vulnerable fixtures together produce >= 10 distinct LLM titles", () => {
    const vulnerableFixtures = [
      "prompt-interpolation.diff",
      "output-to-eval.diff",
      "output-to-html.diff",
      "tool-args.diff",
      "hardcoded-key.diff",
      "prompt-logged.diff",
      "moderation-off.diff",
      "pii-in-prompt.diff",
      "authz-from-model.diff",
      "external-into-prompt.diff"
    ];

    const distinctTitles = new Set<string>();

    for (const fixture of vulnerableFixtures) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      for (const finding of result.findings) {
        if ((ALL_LLM_TITLES as readonly string[]).includes(finding.title)) {
          distinctTitles.add(finding.title);
        }
      }
    }

    expect(distinctTitles.size).toBeGreaterThanOrEqual(10);
  });

  it("each of the 10 LLM vulnerability classes is covered by its dedicated fixture", () => {
    for (const { fixture, title } of FIXTURE_CASES) {
      const diff = readFixture(fixture);
      const result = runHeuristicReview({ mode: "review", subject: "t", diff });
      const found = result.findings.some((f) => f.title === title);
      expect(found, `Fixture ${fixture} must trigger "${title}"`).toBe(true);
    }
  });
});
