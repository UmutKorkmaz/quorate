import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

interface ActionMetadata {
  inputs: Record<string, { default?: string }>;
  outputs: Record<string, { description: string }>;
  runs: { main: string };
}

const root = process.cwd();
const metadata = YAML.parse(readFileSync(resolve(root, "action.yml"), "utf8")) as ActionMetadata;

describe("GitHub Action release contract", () => {
  it("ships the runtime bundle declared by action.yml", () => {
    expect(existsSync(resolve(root, metadata.runs.main))).toBe(true);
  });

  it("keeps public input and output names synchronized with action.yml", () => {
    const rootReadme = readFileSync(resolve(root, "README.md"), "utf8");
    const actionReadme = readFileSync(resolve(root, "packages/github-action/README.md"), "utf8");
    const website = readFileSync(
      resolve(root, "packages/website/src/pages/docs/GithubAction.tsx"),
      "utf8"
    );

    for (const name of Object.keys(metadata.inputs)) {
      expect(rootReadme, `root README input ${name}`).toContain(`\`${name}\``);
      expect(actionReadme, `Action README input ${name}`).toContain(`\`${name}\``);
      expect(website, `website input ${name}`).toContain(`<code>${name}</code>`);
    }

    for (const name of Object.keys(metadata.outputs)) {
      expect(rootReadme, `root README output ${name}`).toContain(`\`${name}\``);
      expect(actionReadme, `Action README output ${name}`).toContain(`\`${name}\``);
      expect(website, `website output ${name}`).toContain(`<InlineCode>${name}</InlineCode>`);
    }
  });
});
