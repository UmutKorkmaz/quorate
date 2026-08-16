import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { compareContracts, parseOpenApi } from "../src/contract.js";
import type { ContractFinding } from "../src/contract.js";

function spec(paths: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ openapi: "3.0.3", info: { title: "API", version: "1.0.0" }, paths, ...extra });
}

function get(op: Record<string, unknown> = {}): Record<string, unknown> {
  return { get: { responses: { "200": { description: "ok" } }, ...op } };
}

function param(name: string, location: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, in: location, ...extra };
}

function body(schema: Record<string, unknown>, contentType = "application/json"): Record<string, unknown> {
  return { requestBody: { required: true, content: { [contentType]: { schema } } } };
}

function run(beforePaths: Record<string, unknown>, afterPaths: Record<string, unknown>) {
  return compareContracts({
    before: { source: spec(beforePaths), label: "base" },
    after: { source: spec(afterPaths), label: "head" }
  });
}

function rules(findings: readonly ContractFinding[]): string[] {
  return findings.map((finding) => finding.rule);
}

describe("parseOpenApi", () => {
  it("parses a JSON OpenAPI 3 document", () => {
    const result = parseOpenApi(spec({ "/a": get() }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.doc as Record<string, unknown>).openapi).toBe("3.0.3");
    }
  });

  it("parses a YAML OpenAPI 3 document", () => {
    const source = ["openapi: 3.0.3", "info: {title: API, version: 1.0.0}", "paths: {}"].join("\n");
    expect(parseOpenApi(source).ok).toBe(true);
  });

  it("accepts a Swagger 2.0 document", () => {
    const source = JSON.stringify({
      swagger: "2.0",
      info: { title: "API", version: "1.0.0" },
      paths: {}
    });
    expect(parseOpenApi(source).ok).toBe(true);
  });

  it("rejects an empty source", () => {
    const result = parseOpenApi("   \n ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty/i);
  });

  it("rejects a YAML mapping without an OpenAPI or Swagger version", () => {
    const result = parseOpenApi("hello: world");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/openapi|swagger/i);
  });

  it("rejects a document missing paths", () => {
    const result = parseOpenApi(JSON.stringify({ openapi: "3.0.3", info: { title: "t", version: "1" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/paths/i);
  });

  it("rejects a document whose paths is not an object", () => {
    const result = parseOpenApi(JSON.stringify({ openapi: "3.0.3", paths: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/paths/i);
  });

  it("rejects a non-string version", () => {
    const result = parseOpenApi(JSON.stringify({ openapi: 3, paths: {} }));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid YAML without throwing", () => {
    expect(parseOpenApi("openapi: [oops").ok).toBe(false);
  });

  it("rejects invalid JSON without throwing", () => {
    expect(parseOpenApi("{ not json").ok).toBe(false);
  });

  it("rejects a top-level array", () => {
    expect(parseOpenApi("[1, 2, 3]").ok).toBe(false);
  });
});

describe("compareContracts: operations", () => {
  it("blocks when an operation is removed", () => {
    const result = run({ "/pets": get() }, {});
    expect(result.verdict).toBe("block");
    expect(result.counts.breaking).toBe(1);
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding.rule).toBe("operation-removed");
    expect(finding.changeType).toBe("breaking");
    expect(finding.severity).toBe("high");
    expect(finding.method).toBe("GET");
    expect(finding.path).toBe("/pets");
    expect(finding.body).toContain("before: present");
    expect(finding.body).toContain("after: absent");
  });

  it("blocks every method when a whole path is removed", () => {
    const result = run(
      { "/pets": { ...get(), post: { responses: { "201": { description: "created" } } } } },
      {}
    );
    expect(result.findings.map((finding) => finding.method).sort()).toEqual(["GET", "POST"]);
    expect(result.counts.breaking).toBe(2);
  });

  it("passes when an operation is added", () => {
    const result = run({}, { "/pets": get() });
    expect(result.verdict).toBe("pass");
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding.rule).toBe("operation-added");
    expect(finding.changeType).toBe("additive");
    expect(finding.severity).toBe("info");
    expect(finding.method).toBe("GET");
    expect(finding.path).toBe("/pets");
  });

  it("passes with zero findings for identical documents", () => {
    const paths = { "/a": get({ parameters: [param("q", "query")] }) };
    const result = run(paths, JSON.parse(JSON.stringify(paths)));
    expect(result.verdict).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual({ breaking: 0, ambiguous: 0, additive: 0 });
  });
});

describe("compareContracts: parameters", () => {
  it("blocks a newly required query parameter", () => {
    const result = run(
      { "/a": get() },
      {
        "/a": get({
          parameters: [param("limit", "query", { required: true, schema: { type: "integer" } })]
        })
      }
    );
    expect(result.verdict).toBe("block");
    expect(rules(result.findings)).toEqual(["required-parameter-added"]);
    expect(result.findings[0].changeType).toBe("breaking");
  });

  it("treats a new path parameter as required even without required: true", () => {
    const result = run(
      { "/a/{id}": get() },
      { "/a/{id}": get({ parameters: [param("id", "path", { schema: { type: "string" } })] }) }
    );
    expect(rules(result.findings)).toEqual(["required-parameter-added"]);
  });

  it("passes for a new optional parameter", () => {
    const result = run(
      { "/a": get() },
      { "/a": get({ parameters: [param("limit", "query", { required: false, schema: { type: "integer" } })] }) }
    );
    expect(result.verdict).toBe("pass");
    expect(rules(result.findings)).toEqual(["optional-parameter-added"]);
    expect(result.counts.additive).toBe(1);
  });

  it("blocks a parameter becoming required", () => {
    const result = run(
      { "/a": get({ parameters: [param("limit", "query", { required: false })] }) },
      { "/a": get({ parameters: [param("limit", "query", { required: true })] }) }
    );
    expect(rules(result.findings)).toEqual(["parameter-became-required"]);
    expect(result.verdict).toBe("block");
  });

  it("marks a parameter becoming optional as additive", () => {
    const result = run(
      { "/a": get({ parameters: [param("limit", "query", { required: true })] }) },
      { "/a": get({ parameters: [param("limit", "query", { required: false })] }) }
    );
    expect(rules(result.findings)).toEqual(["parameter-became-optional"]);
    expect(result.verdict).toBe("pass");
  });

  it("warns when a parameter is removed", () => {
    const result = run({ "/a": get({ parameters: [param("limit", "query")] }) }, { "/a": get() });
    expect(result.verdict).toBe("warn");
    expect(rules(result.findings)).toEqual(["parameter-removed"]);
    const [finding] = result.findings;
    expect(finding.changeType).toBe("ambiguous");
    expect(finding.severity).toBe("medium");
  });

  it("blocks an incompatible parameter type change", () => {
    const result = run(
      {
        "/a": get({
          parameters: [param("limit", "query", { schema: { type: "string" } })]
        })
      },
      { "/a": get({ parameters: [param("limit", "query", { schema: { type: "integer" } })] }) }
    );
    expect(rules(result.findings)).toEqual(["type-changed"]);
    const [finding] = result.findings;
    expect(finding.changeType).toBe("breaking");
    expect(finding.body).toContain("string");
    expect(finding.body).toContain("integer");
  });

  it("marks a one-sided parameter type change as ambiguous", () => {
    const result = run(
      { "/a": get({ parameters: [param("limit", "query")] }) },
      { "/a": get({ parameters: [param("limit", "query", { schema: { type: "integer" } })] }) }
    );
    expect(rules(result.findings)).toEqual(["type-changed"]);
    expect(result.findings[0].changeType).toBe("ambiguous");
    expect(result.verdict).toBe("warn");
  });

  it("marks a format-only parameter change as ambiguous", () => {
    const result = run(
      {
        "/a/{id}": get({
          parameters: [param("id", "path", { required: true, schema: { type: "integer", format: "int32" } })]
        })
      },
      {
        "/a/{id}": get({
          parameters: [param("id", "path", { required: true, schema: { type: "integer", format: "int64" } })]
        })
      }
    );
    expect(rules(result.findings)).toEqual(["format-changed"]);
    expect(result.findings[0].changeType).toBe("ambiguous");
    expect(result.verdict).toBe("warn");
  });

  it("applies path-level parameters to operations", () => {
    const result = run(
      { "/a": { parameters: [param("q", "query", { required: false })], ...get() } },
      { "/a": { parameters: [param("q", "query", { required: true })], ...get() } }
    );
    expect(rules(result.findings)).toEqual(["parameter-became-required"]);
  });

  it("ignores description and example-only parameter changes", () => {
    const result = run(
      {
        "/a": get({
          parameters: [
            param("q", "query", { description: "old", example: 1, schema: { type: "string" } })
          ]
        })
      },
      {
        "/a": get({
          parameters: [
            param("q", "query", {
              description: "new",
              examples: { a: { value: 1 } },
              schema: { type: "string" }
            })
          ]
        })
      }
    );
    expect(result.findings).toEqual([]);
    expect(result.verdict).toBe("pass");
  });
});

describe("compareContracts: request body fields", () => {
  it("blocks a newly added required request field", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } } })) },
      {
        "/a": get(
          body({
            type: "object",
            properties: { name: { type: "string" }, email: { type: "string" } },
            required: ["email"]
          })
        )
      }
    );
    expect(rules(result.findings)).toEqual(["required-request-field-added"]);
    expect(result.verdict).toBe("block");
    expect(result.findings[0].body).toContain("email");
  });

  it("blocks a field newly listed as required", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } }, required: [] })) },
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } }, required: ["name"] })) }
    );
    expect(rules(result.findings)).toEqual(["request-field-became-required"]);
    expect(result.verdict).toBe("block");
  });

  it("analyzes application/json media types with parameters", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } } })) },
      {
        "/a": get(
          body({ type: "object", properties: { name: { type: "string" } }, required: ["name"] }, "application/json; charset=utf-8")
        )
      }
    );
    expect(rules(result.findings)).toEqual(["request-field-became-required"]);
  });

  it("passes for a new optional request field", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } } })) },
      {
        "/a": get(
          body({ type: "object", properties: { name: { type: "string" }, nick: { type: "string" } } })
        )
      }
    );
    expect(rules(result.findings)).toEqual(["optional-request-field-added"]);
    expect(result.verdict).toBe("pass");
  });

  it("marks a field becoming optional as additive", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } }, required: ["name"] })) },
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } }, required: [] })) }
    );
    expect(rules(result.findings)).toEqual(["request-field-became-optional"]);
    expect(result.verdict).toBe("pass");
  });

  it("warns when a request field is removed", () => {
    const result = run(
      {
        "/a": get(
          body({ type: "object", properties: { name: { type: "string" }, email: { type: "string" } } })
        )
      },
      { "/a": get(body({ type: "object", properties: { name: { type: "string" } } })) }
    );
    expect(rules(result.findings)).toEqual(["request-field-removed"]);
    expect(result.verdict).toBe("warn");
  });

  it("blocks an incompatible request field type change", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { age: { type: "string" } } })) },
      { "/a": get(body({ type: "object", properties: { age: { type: "integer" } } })) }
    );
    expect(rules(result.findings)).toEqual(["type-changed"]);
    const [finding] = result.findings;
    expect(finding.changeType).toBe("breaking");
    expect(finding.body).toContain("age");
  });

  it("marks a request field format-only change as ambiguous", () => {
    const result = run(
      {
        "/a": get(
          body({ type: "object", properties: { born: { type: "string", format: "date-time" } } })
        )
      },
      { "/a": get(body({ type: "object", properties: { born: { type: "string", format: "date" } } })) }
    );
    expect(rules(result.findings)).toEqual(["format-changed"]);
    expect(result.verdict).toBe("warn");
  });

  it("analyzes nested request fields one level deep", () => {
    const result = run(
      {
        "/a": get(
          body({
            type: "object",
            properties: {
              address: { type: "object", properties: { street: { type: "string" } } }
            }
          })
        )
      },
      {
        "/a": get(
          body({
            type: "object",
            properties: {
              address: {
                type: "object",
                properties: { street: { type: "string" }, zip: { type: "string" } },
                required: ["street", "zip"]
              }
            }
          })
        )
      }
    );
    expect(rules(result.findings)).toEqual(["request-field-became-required", "required-request-field-added"]);
    const joined = result.findings.map((finding) => finding.body).join("\n");
    expect(joined).toContain("address.street");
    expect(joined).toContain("address.zip");
    expect(result.verdict).toBe("block");
  });

  it("emits no field findings when a JSON schema is missing", () => {
    const result = run(
      { "/a": get({ requestBody: { content: { "application/json": {} } } }) },
      { "/a": get({ requestBody: { content: { "text/plain": { schema: { type: "string" } } } } }) }
    );
    expect(result.findings).toEqual([]);
    expect(result.verdict).toBe("pass");
  });
});

describe("compareContracts: enums", () => {
  it("blocks a removed enum value on a parameter", () => {
    const result = run(
      {
        "/a": get({
          parameters: [param("status", "query", { schema: { type: "string", enum: ["active", "inactive"] } })]
        })
      },
      { "/a": get({ parameters: [param("status", "query", { schema: { type: "string", enum: ["active"] } })] }) }
    );
    expect(rules(result.findings)).toEqual(["enum-value-removed"]);
    const [finding] = result.findings;
    expect(finding.changeType).toBe("breaking");
    expect(finding.body).toContain("inactive");
  });

  it("passes an added enum value on a request field", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { role: { type: "string", enum: ["admin"] } } })) },
      {
        "/a": get(
          body({ type: "object", properties: { role: { type: "string", enum: ["admin", "auditor"] } } })
        )
      }
    );
    expect(rules(result.findings)).toEqual(["enum-value-added"]);
    expect(result.findings[0].changeType).toBe("additive");
    expect(result.verdict).toBe("pass");
  });

  it("blocks an enum constraint added to an unconstrained field", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { status: { type: "string" } } })) },
      {
        "/a": get(
          body({ type: "object", properties: { status: { type: "string", enum: ["on", "off"] } } })
        )
      }
    );
    expect(rules(result.findings)).toEqual(["enum-constraint-added"]);
    expect(result.findings[0].changeType).toBe("breaking");
  });

  it("marks a removed enum constraint as additive", () => {
    const result = run(
      { "/a": get(body({ type: "object", properties: { status: { type: "string", enum: ["on"] } } })) },
      { "/a": get(body({ type: "object", properties: { status: { type: "string" } } })) }
    );
    expect(rules(result.findings)).toEqual(["enum-constraint-removed"]);
    expect(result.verdict).toBe("pass");
  });
});

describe("compareContracts: responses", () => {
  it("blocks a removed 2xx response", () => {
    const result = run(
      { "/a": get({ responses: { "200": { description: "ok" }, "201": { description: "created" } } }) },
      { "/a": get({ responses: { "200": { description: "ok" } } }) }
    );
    expect(rules(result.findings)).toEqual(["success-response-removed"]);
    const [finding] = result.findings;
    expect(finding.changeType).toBe("breaking");
    expect(finding.method).toBe("GET");
    expect(finding.path).toBe("/a");
    expect(finding.body).toContain("201");
  });

  it("passes a newly added 2xx response", () => {
    const result = run(
      { "/a": get({ responses: { "200": { description: "ok" } } }) },
      { "/a": get({ responses: { "200": { description: "ok" }, "204": { description: "done" } } }) }
    );
    expect(rules(result.findings)).toEqual(["success-response-added"]);
    expect(result.verdict).toBe("pass");
  });

  it("ignores non-2xx response changes", () => {
    const result = run(
      { "/a": get({ responses: { "200": { description: "ok" }, "404": { description: "nope" } } }) },
      { "/a": get({ responses: { "200": { description: "ok" } } }) }
    );
    expect(result.findings).toEqual([]);
    expect(result.verdict).toBe("pass");
  });

  it("accepts unquoted numeric YAML response keys", () => {
    const yamlDoc = (statuses: string[]): string =>
      [
        "openapi: 3.0.3",
        "info: {title: API, version: 1.0.0}",
        "paths:",
        "  /a:",
        "    get:",
        "      responses:",
        ...statuses.map((status) => `        ${status}: {description: ok}`)
      ].join("\n");
    const result = compareContracts({
      before: { source: yamlDoc(["200", "201"]), label: "base" },
      after: { source: yamlDoc(["200"]), label: "head" }
    });
    expect(rules(result.findings)).toEqual(["success-response-removed"]);
    expect(result.verdict).toBe("block");
  });
});

describe("compareContracts: verdict aggregation", () => {
  it("aggregates counts and blocks on any breaking change", () => {
    const result = run(
      {
        "/old": { post: { responses: { "200": { description: "ok" } } } },
        "/a": get({ parameters: [param("q", "query")] })
      },
      { "/a": get(), "/new": get() }
    );
    expect(result.verdict).toBe("block");
    expect(result.counts).toEqual({ breaking: 1, ambiguous: 1, additive: 1 });
    expect(result.findings.map((finding) => finding.severity).sort()).toEqual(["high", "info", "medium"]);
  });

  it("warns when only ambiguous changes are present", () => {
    const result = run(
      { "/a": get({ parameters: [param("q", "query")] }) },
      { "/a": get() }
    );
    expect(result.verdict).toBe("warn");
    expect(result.counts).toEqual({ breaking: 0, ambiguous: 1, additive: 0 });
  });
});

describe("compareContracts: identity and determinism", () => {
  it("records source hashes and labels", () => {
    const beforeSource = spec({ "/a": get() });
    const afterSource = spec({ "/a": get(), "/b": get() });
    const result = compareContracts({
      before: { source: beforeSource, label: "base" },
      after: { source: afterSource, label: "head" }
    });
    expect(result.before).toEqual({
      label: "base",
      hash: createHash("sha256").update(beforeSource, "utf8").digest("hex")
    });
    expect(result.after.label).toBe("head");
    expect(result.after.hash).toBe(createHash("sha256").update(afterSource, "utf8").digest("hex"));
  });

  it("is byte-identical across two runs", () => {
    const before = { "/a": get(body({ type: "object", properties: { age: { type: "string" } } })) };
    const after = { "/a": get(body({ type: "object", properties: { age: { type: "integer" } } })) };
    const first = run(before, after);
    const second = run(before, after);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps findings and fingerprints stable across key reorderings", () => {
    const beforeSchema = {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "integer", format: "int32" } },
      required: ["name"]
    };
    const afterSchema = {
      type: "object",
      properties: { age: { type: "integer", format: "int32" }, name: { type: "string" } },
      required: ["age", "name"]
    };
    const before = {
      "/z": get(body(beforeSchema)),
      "/y": get({
        parameters: [param("s", "query", { schema: { type: "string", enum: ["a", "b"] } })],
        responses: { "201": { description: "created" }, "200": { description: "ok" } }
      })
    };
    const after = {
      "/y": get({
        responses: { "200": { description: "ok" } },
        parameters: [param("s", "query", { schema: { type: "string", enum: ["a"] } })]
      }),
      "/z": get(body(afterSchema))
    };
    const first = run(before, after);
    // /y findings sort before /z findings (path first), then by rule.
    expect(rules(first.findings)).toEqual([
      "enum-value-removed",
      "success-response-removed",
      "request-field-became-required"
    ]);

    // Same content, every key and list order reversed.
    const beforeReordered = {
      "/y": before["/y"],
      "/z": get(
        body({
          required: ["name"],
          properties: { age: { format: "int32", type: "integer" }, name: { type: "string" } },
          type: "object"
        })
      )
    };
    const afterReordered = {
      "/z": get(
        body({
          type: "object",
          required: ["name", "age"],
          properties: { name: { type: "string" }, age: { type: "integer", format: "int32" } }
        })
      ),
      "/y": after["/y"]
    };
    const second = run(beforeReordered, afterReordered);
    expect(second.findings).toEqual(first.findings);
    expect(second.verdict).toBe(first.verdict);
    expect(second.counts).toEqual(first.counts);
  });

  it("issues unique 16-hex fingerprints", () => {
    const result = run(
      {
        "/old": { post: { responses: { "200": { description: "ok" } } } },
        "/a": get({ parameters: [param("q", "query")] })
      },
      { "/a": get(), "/new": get() }
    );
    const ids = result.findings.map((finding) => finding.id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sorts findings by path, then method, then rule", () => {
    const result = run(
      {
        "/b": { ...get(), post: { responses: { "200": { description: "ok" } } } },
        "/a": get({
          parameters: [param("q", "query")],
          responses: { "200": { description: "ok" }, "201": { description: "created" } }
        })
      },
      {
        "/b": get(),
        "/a": get({ responses: { "404": { description: "nope" }, "200": { description: "ok" } } })
      }
    );
    expect(
      result.findings.map((finding) => `${finding.path} ${finding.method} ${finding.rule}`)
    ).toEqual([
      "/a GET parameter-removed",
      "/a GET success-response-removed",
      "/b POST operation-removed"
    ]);
  });
});

describe("compareContracts: input handling", () => {
  it("throws a clear error when the before source is not parseable", () => {
    expect(() =>
      compareContracts({
        before: { source: "hello: world", label: "base" },
        after: { source: spec({}), label: "head" }
      })
    ).toThrow(/before/);
  });

  it("throws a clear error when the after source is not parseable", () => {
    expect(() =>
      compareContracts({
        before: { source: spec({}), label: "base" },
        after: { source: "not: a: valid: document", label: "head" }
      })
    ).toThrow(/after/);
  });

  it("compares Swagger 2.0 documents using inline parameter types", () => {
    const doc = (required: boolean): string =>
      JSON.stringify({
        swagger: "2.0",
        info: { title: "API", version: "1.0.0" },
        paths: {
          "/x": {
            get: {
              parameters: [{ name: "q", in: "query", required, type: "string" }],
              responses: { "200": { description: "ok" } }
            }
          }
        }
      });
    const result = compareContracts({
      before: { source: doc(false), label: "base" },
      after: { source: doc(true), label: "head" }
    });
    expect(rules(result.findings)).toEqual(["parameter-became-required"]);
    expect(result.verdict).toBe("block");
  });

  it("accepts YAML source for both sides", () => {
    const yamlSpec = (paths: unknown): string =>
      YAML.stringify({ openapi: "3.0.3", info: { title: "API", version: "1.0.0" }, paths });
    const result = compareContracts({
      before: { source: yamlSpec({ "/a": { get: { responses: { "200": { description: "ok" } } } } }), label: "base" },
      after: { source: yamlSpec({}), label: "head" }
    });
    expect(rules(result.findings)).toEqual(["operation-removed"]);
  });
});

describe("compareContracts: $ref resolution and response schemas", () => {
  const components = (schemas: Record<string, unknown>, responses: Record<string, unknown> = {}): Record<string, unknown> => ({
    components: { schemas, responses }
  });

  it("resolves $ref'd request bodies: a field newly listed as required is breaking", () => {
    const create = (required: string[]): Record<string, unknown> => ({
      "/tasks": {
        post: {
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TaskCreate" } } } },
          responses: { "201": { description: "created" } }
        }
      }
    });
    const schemas = (required: string[]): Record<string, unknown> => ({
      TaskCreate: {
        type: "object",
        required,
        properties: { title: { type: "string" }, priority: { type: "string" } }
      }
    });
    const result = compareContracts(
      { before: { source: spec(create(["title"]), components(schemas(["title"]))), label: "base" } as never, after: { source: spec(create(["title", "priority"]), components(schemas(["title", "priority"]))), label: "head" } as never }
    );
    expect(result.verdict).toBe("block");
    expect(rules(result.findings)).toContain("request-field-became-required");
  });

  it("resolves $ref'd response objects and schemas: a response field type change is breaking", () => {
    const paths = (): Record<string, unknown> => ({
      "/tasks": { get: { responses: { "400": { $ref: "#/components/responses/BadRequest" } } } }
    });
    const docs = (codeType: string): Record<string, unknown> =>
      components(
        { Error: { type: "object", required: ["code"], properties: { code: { type: codeType } } } },
        { BadRequest: { description: "bad", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } }
      );
    const comparison = compareContracts({
      before: { source: spec(paths(), docs("string")), label: "base" },
      after: { source: spec(paths(), docs("integer")), label: "head" }
    });
    expect(comparison.verdict).toBe("block");
    expect(rules(comparison.findings)).toContain("type-changed");
    expect(comparison.findings.find((f) => f.rule === "type-changed")?.body).toContain('Response 400 body field "code"');
  });

  it("resolves $ref'd parameter schemas: removing an enum value is breaking", () => {
    const paths = (): Record<string, unknown> => ({
      "/tasks": { get: { parameters: [{ name: "status", in: "query", schema: { $ref: "#/components/schemas/Status" } }], responses: { "200": { description: "ok" } } } }
    });
    const docs = (values: string[]): Record<string, unknown> =>
      components({ Status: { type: "string", enum: values } });
    const comparison = compareContracts({
      before: { source: spec(paths(), docs(["todo", "done"])), label: "base" },
      after: { source: spec(paths(), docs(["todo"])), label: "head" }
    });
    expect(comparison.verdict).toBe("block");
    expect(rules(comparison.findings)).toContain("enum-value-removed");
  });

  it("unwraps array items: a type change inside `array of $ref X` response bodies is breaking", () => {
    const paths = (): Record<string, unknown> => ({
      "/tasks": {
        get: {
          responses: {
            "200": {
              description: "list",
              content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Task" } } } }
            }
          }
        }
      }
    });
    const docs = (titleType: string): Record<string, unknown> =>
      components({ Task: { type: "object", required: ["title"], properties: { title: { type: titleType } } } });
    const comparison = compareContracts({
      before: { source: spec(paths(), docs("string")), label: "base" },
      after: { source: spec(paths(), docs("integer")), label: "head" }
    });
    expect(comparison.verdict).toBe("block");
    expect(rules(comparison.findings)).toContain("type-changed");
  });

  it("response field additions are not classified", () => {
    const paths = { "/a": get() };
    const docs = (extra: boolean): Record<string, unknown> =>
      components(
        {},
        { OK: { description: "ok", content: { "application/json": { schema: { type: "object", properties: extra ? { total: { type: "integer" } } : {} } } } } }
      );
    const withRef = { "/a": { get: { responses: { "200": { $ref: "#/components/responses/OK" } } } } };
    const comparison = compareContracts({
      before: { source: spec(withRef, docs(false)), label: "base" },
      after: { source: spec(withRef, docs(true)), label: "head" }
    });
    expect(comparison.verdict).toBe("pass");
    expect(comparison.findings).toHaveLength(0);
  });

  it("symmetric unresolvable external refs produce no findings", () => {
    const paths = { "/a": get({ ...body({ $ref: "https://example.com/remote.yaml" }) }) };
    const comparison = run(paths, paths);
    expect(comparison.verdict).toBe("pass");
    expect(comparison.findings).toHaveLength(0);
  });

  it("survives $ref cycles without hanging", () => {
    const paths = { "/a": get({ ...body({ $ref: "#/components/schemas/A" }) }) };
    const docs = components({
      A: { type: "object", properties: { b: { $ref: "#/components/schemas/B" } } },
      B: { type: "object", properties: { a: { $ref: "#/components/schemas/A" } } }
    });
    const comparison = compareContracts({
      before: { source: spec(paths, docs), label: "base" },
      after: { source: spec(paths, docs), label: "head" }
    });
    expect(comparison.verdict).toBe("pass");
    expect(comparison.findings).toHaveLength(0);
  });
});
