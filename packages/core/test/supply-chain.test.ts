import { describe, expect, it } from "vitest";
import { runCouncil } from "../src/council.js";
import { createDefaultConfig } from "../src/providers.js";
import { runSupplyChainReview, supplyChainReviewEnabled } from "../src/supply-chain.js";
import type { CouncilEvent } from "../src/types.js";

const packageJsonDependencyDiff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2,6 +2,7 @@
   "private": true,
   "dependencies": {
+    "left-pad": "^1.3.0",
     "yaml": "^2.8.1"
   }
 }`;

describe("SupplyChainGate", () => {
  it("scans standard unified patches that omit git's diff --git header", () => {
    const diff = `--- a/Dockerfile
+++ b/Dockerfile
@@ -1 +1 @@
-FROM node@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
+FROM node:latest`;
    const result = runSupplyChainReview({ mode: "review", subject: "raw patch", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Docker base image is not pinned by digest" })
    );
  });

  it("scans every file in a multi-file raw unified patch", () => {
    const diff = `--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
--- a/Dockerfile
+++ b/Dockerfile
@@ -1 +1 @@
-FROM node@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
+FROM node:latest`;
    const result = runSupplyChainReview({ mode: "review", subject: "raw patch", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "Docker base image is not pinned by digest",
        file: "Dockerfile"
      })
    );
  });

  it("flags package.json dependency additions without a corresponding lockfile change", () => {
    const result = runSupplyChainReview({
      mode: "review",
      subject: "dependency",
      diff: packageJsonDependencyDiff
    });

    expect(result?.providerId).toBe("supply-chain");
    expect(result?.providerType).toBe("mock");
    expect(result?.status).toBe("ok");
    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        severity: "high",
        title: "Dependency added without lockfile update",
        file: "package.json"
      })
    );
  });

  it("detects dependency additions even when the diff hunk omits the section header", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -20,6 +20,7 @@
     "express": "^4.18.3",
+    "lodash": "^4.17.21",
     "yaml": "^2.8.1",
     "zod": "^4.1.13"
   }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "Dependency added without lockfile update",
        file: "package.json"
      })
    );
  });

  it.each(["latest", ">=1.0.0"]) (
    "detects the %s npm spec when a hunk omits the dependency-section header",
    (version) => {
      const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -20,3 +20,4 @@
     "express": "^4.18.3",
+    "left-pad": "${version}",
     "yaml": "^2.8.1",
     "zod": "^4.1.13"`;
      const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

      expect(result?.findings).toContainEqual(
        expect.objectContaining({ title: "Dependency added without lockfile update" })
      );
    }
  );

  it("does not mistake bare package script commands for dependency specs", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -20,3 +20,4 @@
   "scripts": {
     "format": "prettier",
+    "lint": "eslint",
     "test": "vitest"
   }`;
    const result = runSupplyChainReview({ mode: "review", subject: "scripts", diff });

    expect(
      result?.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("does not mistake a visible non-dependency package.json section for dependencies", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -20,3 +20,4 @@
   "engines": {
     "node": ">=20",
+    "npm": ">=10"
   }`;
    const result = runSupplyChainReview({ mode: "review", subject: "engines", diff });

    expect(
      result?.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("does not accept an unrelated lockfile edit as dependency resolution evidence", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "lockfileVersion": 3,
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept a different package whose name only contains the added dependency", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "node_modules/not-left-pad-helper": { "version": "1.0.0" },
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept a package-lock entry without resolution or integrity evidence", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "node_modules/left-pad": { "version": "1.3.0" },
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept a structurally resolved package-lock entry with an incompatible version", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "node_modules/left-pad": { "version": "2.0.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-2.0.0.tgz", "integrity": "sha512-test" },
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not reuse metadata from the next package-lock entry", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,5 @@
 {
+  "node_modules/left-pad": {},
+  "node_modules/other-package": { "version": "1.3.0", "resolved": "https://registry.npmjs.org/other-package/-/other-package-1.3.0.tgz", "integrity": "sha512-other" },
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept a lockfile from a different declared package manager", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,7 @@
 {
   "packageManager": "npm@11.0.0",
   "dependencies": {
+    "left-pad": "^1.3.0",
     "yaml": "^2.8.1"
   }
 }
diff --git a/yarn.lock b/yarn.lock
--- a/yarn.lock
+++ b/yarn.lock
@@ -1 +1,5 @@
 # yarn lockfile v1
+left-pad@^1.3.0:
+  version "1.3.0"
+  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"
+  integrity sha512-test`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not reuse pnpm integrity metadata from another package block", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,7 @@
 {
   "packageManager": "pnpm@10.0.0",
   "dependencies": {
+    "left-pad": "^1.3.0",
     "yaml": "^2.8.1"
   }
 }
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1,12 @@
 lockfileVersion: '9.0'
+importers:
+  .:
+    dependencies:
+      left-pad:
+        specifier: ^1.3.0
+        version: 1.3.0
+packages:
+  left-pad@1.3.0:
+    resolution: {}
+  other@1.0.0:
+    resolution: {integrity: sha512-other}`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("requires a Yarn integrity or checksum in the exact dependency block", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,7 @@
 {
   "packageManager": "yarn@4.0.0",
   "dependencies": {
+    "left-pad": "^1.3.0",
     "yaml": "^2.8.1"
   }
 }
diff --git a/yarn.lock b/yarn.lock
--- a/yarn.lock
+++ b/yarn.lock
@@ -1 +1,4 @@
 # yarn lockfile v1
+left-pad@^1.3.0:
+  version "1.3.0"
+  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not reuse Bun integrity metadata from another package entry", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,6 +1,7 @@
 {
   "packageManager": "bun@1.2.0",
   "dependencies": {
+    "left-pad": "^1.3.0",
     "yaml": "^2.8.1"
   }
 }
diff --git a/bun.lock b/bun.lock
--- a/bun.lock
+++ b/bun.lock
@@ -1,2 +1,4 @@
 {
+  "left-pad": ["left-pad@1.3.0", "", {}, ""],
+  "other": ["other@1.0.0", "", {}, "sha512-other"],
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("accepts a structurally resolved package-lock entry for the added dependency", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "node_modules/left-pad": { "version": "1.3.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", "integrity": "sha512-test" },
   "packages": {}
 }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(
      result?.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("accepts a package-lock version update when the dependency header is context", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1,5 +1,5 @@
 {
   "dependencies": {
-    "left-pad": "^1.2.0"
+    "left-pad": "^1.3.0"
   }
 }
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -2,3 +2,3 @@
   "node_modules/left-pad": {
-    "version": "1.2.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.2.0.tgz", "integrity": "sha512-old"
+    "version": "1.3.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", "integrity": "sha512-new"
   }`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency update", diff });

    expect(
      result?.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("does not accept a lockfile comment that merely mentions the dependency", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/yarn.lock b/yarn.lock
--- a/yarn.lock
+++ b/yarn.lock
@@ -1 +1,2 @@
 # yarn lockfile v1
+# left-pad ^1.3.0`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept another ecosystem's lockfile for an npm dependency", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/Cargo.lock b/Cargo.lock
--- a/Cargo.lock
+++ b/Cargo.lock
@@ -1,2 +1,3 @@
 [[package]]
+name = "left-pad"`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("does not accept a deleted lockfile as dependency resolution evidence", () => {
    const diff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
deleted file mode 100644
--- a/package-lock.json
+++ /dev/null
@@ -1,2 +0,0 @@
-{"packages":{"node_modules/left-pad":{}}}`;
    const result = runSupplyChainReview({ mode: "review", subject: "dependency", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Dependency added without lockfile update" })
    );
  });

  it("flags third-party GitHub Actions that are not pinned to a full SHA", () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -4,5 +4,7 @@
     steps:
+      - uses: actions/checkout@v4
+      - uses: org/internal-action@1234567890abcdef1234567890abcdef12345678
+      - uses: ./.github/actions/local
       - run: npm test`;
    const result = runSupplyChainReview({ mode: "review", subject: "actions", diff });

    const actionFindings = result?.findings.filter(
      (finding) => finding.title === "Action not pinned to a commit SHA"
    );
    expect(actionFindings).toHaveLength(1);
    expect(actionFindings?.[0]).toEqual(
      expect.objectContaining({ file: ".github/workflows/ci.yml", severity: "medium" })
    );
  });

  it("flags Docker-based Actions that are not pinned to a full image digest", () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -4,2 +4,4 @@
     steps:
+      - uses: docker://alpine:latest
+      - uses: docker://alpine@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`;
    const result = runSupplyChainReview({ mode: "review", subject: "actions", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "Container action is not pinned by digest",
        file: ".github/workflows/ci.yml"
      })
    );
    expect(
      result?.findings.filter((finding) => finding.title === "Container action is not pinned by digest")
    ).toHaveLength(1);
  });

  it("flags Docker FROM instructions that are not pinned by digest", () => {
    const diff = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -1,2 +1,4 @@
+FROM node:latest AS deps
+FROM alpine:3.20
+FROM gcr.io/distroless/nodejs@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
 RUN node --version`;
    const result = runSupplyChainReview({ mode: "review", subject: "docker", diff });

    const dockerFindings = result?.findings.filter(
      (finding) => finding.title === "Docker base image is not pinned by digest"
    );
    expect(dockerFindings).toHaveLength(2);
    expect(dockerFindings?.map((finding) => finding.line)).toEqual([1, 2]);
  });

  it("rejects malformed sha256 image digests instead of treating them as immutable pins", () => {
    const diff = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -0,0 +1 @@
+FROM node@sha256:abc123`;
    const result = runSupplyChainReview({ mode: "review", subject: "docker", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "Docker base image is not pinned by digest",
        file: "Dockerfile",
        line: 1
      })
    );
  });

  it("fails closed on variable Docker base images whose digest cannot be verified", () => {
    const diff = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -0,0 +1,2 @@
+ARG BASE_IMAGE=node:latest
+FROM \${BASE_IMAGE}`;
    const result = runSupplyChainReview({ mode: "review", subject: "docker", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "Docker base image is not pinned by digest",
        file: "Dockerfile",
        line: 2
      })
    );
  });

  it("flags npm publish workflows that use npm tokens without provenance hints", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -1,3 +1,11 @@
+name: publish
+on:
+  release:
+    types: [published]
+jobs:
+  publish:
+    steps:
+      - run: npm publish
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        title: "npm publish workflow lacks provenance hardening",
        severity: "medium",
        file: ".github/workflows/publish.yml"
      })
    );
  });

  it("does not flag npm publish workflows with id-token or provenance hints", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -1,3 +1,14 @@
+name: publish
+permissions:
+  id-token: write
+on: workflow_dispatch
+jobs:
+  publish:
+    steps:
+      - run: npm publish --provenance
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(
      result?.findings.some((finding) => finding.title === "npm publish workflow lacks provenance hardening")
    ).toBe(false);
  });

  it("flags token-based npm publishing when id-token permission is present but provenance is not enabled", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,10 @@
+name: publish
+permissions:
+  id-token: write
+jobs:
+  publish:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("flags token-based npm publishing when provenance is enabled but id-token permission is missing", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,8 @@
+name: publish
+jobs:
+  publish:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish --provenance
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("does not let another job's id-token permission harden an unsafe publish job", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,19 @@
+name: publish
+jobs:
+  attest:
+    permissions:
+      id-token: write
+    runs-on: ubuntu-latest
+    steps:
+      - run: echo safe
+  publish:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish --provenance
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("treats --provenance=false as disabled", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,12 @@
+name: publish
+permissions:
+  id-token: write
+jobs:
+  publish:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish --provenance=false
+        env:
+          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("fails closed when an added publish command lacks enough hunk context to prove hardening", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -40,2 +40,3 @@
       - run: npm test
+      - run: npm publish`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("does not assume trusted publishing when token context may be outside a partial hunk", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -38,3 +38,5 @@
     permissions:
       id-token: write
+    steps:
+      - run: npm publish`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("fails closed when an npm token is added but the existing publish step is outside the hunk", () => {
    const diff = `diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -30,2 +30,4 @@
     env:
+      NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
       CI: true`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm token added without visible provenance context" })
    );
  });

  it("recognizes arbitrary npm auth token names configured through npmrc", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
new file mode 100644
--- /dev/null
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,9 @@
+name: Publish
+permissions:
+  id-token: write
+jobs:
+  release:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm config set //registry.npmjs.org/:_authToken \${{ secrets.PUBLISH_TOKEN }}
+      - run: npm publish`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("does not borrow provenance hardening from a different workflow job", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -2,5 +2,13 @@
 jobs:
   prepare:
     runs-on: ubuntu-latest
+    env:
+      NODE_AUTH_TOKEN: \${{ secrets.PUBLISH_TOKEN }}
     steps:
       - run: npm test
+  release:
+    permissions:
+      id-token: write
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish --provenance`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm token added without visible provenance context" })
    );
  });

  it("flags a changed package script that can publish outside the visible workflow diff", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -2,3 +2,4 @@
   "scripts": {
+    "release": "npm publish",
     "test": "vitest run"
   }`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish script lacks provenance context" })
    );
  });

  it("recognizes pnpm publish commands", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
new file mode 100644
--- /dev/null
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,6 @@
+name: Publish
+jobs:
+  release:
+    runs-on: ubuntu-latest
+    steps:
+      - run: pnpm publish`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm publish workflow lacks provenance hardening" })
    );
  });

  it("flags removal of npm provenance hardening even when the publish job is outside the hunk", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
new file mode 100644
--- /dev/null
+++ b/.github/workflows/publish.yml
@@ -5,3 +5,2 @@
 permissions:
-  id-token: write
   contents: read`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm provenance hardening was removed" })
    );
  });

  it("uses the old-side line number for a removed provenance permission", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -5,3 +5 @@
-  contents: read
-  id-token: write
   actions: read`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "npm provenance hardening was removed", line: 6 })
    );
  });

  it("accepts tokenless trusted publishing when id-token permission is visible", () => {
    const diff = `diff --git a/.github/workflows/publish.yml b/.github/workflows/publish.yml
--- a/.github/workflows/publish.yml
+++ b/.github/workflows/publish.yml
@@ -0,0 +1,10 @@
+name: publish
+permissions:
+  id-token: write
+jobs:
+  publish:
+    runs-on: ubuntu-latest
+    steps:
+      - run: npm publish`;
    const result = runSupplyChainReview({ mode: "review", subject: "publish", diff });

    expect(
      result?.findings.some((finding) =>
        finding.title.startsWith("npm publish workflow lacks provenance")
      )
    ).toBe(false);
  });

  it("fails closed when the supplied diff is marked incomplete", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new
# quorate-supply-chain-incomplete: diff truncated before all files were included`;
    const config = { ...createDefaultConfig(), supplyChain: { enabled: true } };
    const result = runSupplyChainReview({ mode: "review", subject: "incomplete", diff }, config);

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        severity: "high",
        title: "Supply-chain scan evidence is incomplete"
      })
    );
  });

  it("fails closed when a non-empty unified diff hunk ends before its declared counts", () => {
    const diff = `diff --git a/.github/workflows/release.yml b/.github/workflows/release.yml
--- a/.github/workflows/release.yml
+++ b/.github/workflows/release.yml
@@ -1,3 +1,3 @@
-name: Old
+name: New`;
    const result = runSupplyChainReview({ mode: "review", subject: "incomplete hunk", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({
        severity: "high",
        title: "Supply-chain scan evidence is incomplete"
      })
    );
  });

  it("does not treat an added source-code string as an Action diff marker", () => {
    const diff = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -0,0 +1,2 @@
+FROM node@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
+RUN echo '# quorate-supply-chain-incomplete: user text'`;
    const result = runSupplyChainReview({ mode: "review", subject: "marker text", diff });

    expect(result?.findings).toEqual([]);
  });

  it("does not allow PR-controlled inline markers to suppress gate findings", () => {
    const diff = `diff --git a/Dockerfile b/Dockerfile
--- a/Dockerfile
+++ b/Dockerfile
@@ -0,0 +1 @@
+FROM node:latest # quorate-ignore`;
    const result = runSupplyChainReview({ mode: "review", subject: "docker", diff });

    expect(result?.findings).toContainEqual(
      expect.objectContaining({ title: "Docker base image is not pinned by digest" })
    );
  });

  it("honors lockfiles.requireFor when npm lockfile enforcement is not selected", () => {
    const config = {
      ...createDefaultConfig(),
      supplyChain: {
        enabled: true,
        lockfiles: { requireFor: ["cargo"], onMissing: "fail" as const }
      }
    };
    const result = runSupplyChainReview(
      { mode: "review", subject: "dependency", diff: packageJsonDependencyDiff },
      config
    );

    expect(
      result?.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("feeds SupplyChainGate findings through the normal council report path", async () => {
    const config = { ...createDefaultConfig(), supplyChain: { enabled: true } };
    const report = await runCouncil(
      {
        mode: "review",
        subject: "council",
        diff: packageJsonDependencyDiff
      },
      config
    );

    expect(report.providerResults.some((result) => result.providerId === "supply-chain")).toBe(true);
    expect(report.metadata.requestedProviders).toContain("supply-chain:supply-chain");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        providerId: "supply-chain",
        title: "Dependency added without lockfile update"
      })
    );
  });

  it("emits provider lifecycle events for the SupplyChainGate lane", async () => {
    const config = { ...createDefaultConfig(), supplyChain: { enabled: true } };
    const events: CouncilEvent[] = [];

    await runCouncil(
      { mode: "review", subject: "events", diff: packageJsonDependencyDiff },
      config,
      { onEvent: (event) => events.push(event) }
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "provider/started", providerId: "supply-chain" })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "provider/done", providerId: "supply-chain" })
    );
  });

  it("uses fullDiff lockfile evidence when the reviewed diff was budget-filtered", async () => {
    const filteredDiff = packageJsonDependencyDiff;
    const fullDiff = `${packageJsonDependencyDiff}
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,4 @@
 {
+  "node_modules/left-pad": { "version": "1.3.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", "integrity": "sha512-test" },
   "packages": {}
 }`;
    const config = { ...createDefaultConfig(), supplyChain: { enabled: true } };
    const report = await runCouncil(
      {
        mode: "review",
        subject: "council",
        diff: filteredDiff,
        fullDiff
      },
      config
    );

    expect(
      report.findings.some((finding) => finding.title === "Dependency added without lockfile update")
    ).toBe(false);
  });

  it("describes all deterministic reviewers when real providers fail", async () => {
    const config = {
      councils: ["maintainer"],
      providers: [{ id: "remote", type: "api" as const, roles: ["maintainer"], enabled: true }],
      github: { commentMode: "off" as const, failOn: "high" as const, runnerMode: "auto" as const },
      supplyChain: { enabled: true }
    };
    const report = await runCouncil(
      { mode: "review", subject: "degraded", diff: packageJsonDependencyDiff },
      config
    );

    expect(report.metadata.degraded).toBe(true);
    expect(report.summary).toContain("deterministic reviewers");
    expect(report.summary).not.toContain("only on the heuristic");
  });

  it("forces a failure when an enabled SupplyChainGate run is interrupted", async () => {
    const controller = new AbortController();
    controller.abort();
    const config = { ...createDefaultConfig(), supplyChain: { enabled: true } };

    const report = await runCouncil(
      { mode: "review", subject: "interrupted", diff: packageJsonDependencyDiff },
      config,
      { signal: controller.signal }
    );

    expect(report.verdict).toBe("fail");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ severity: "high", title: "SupplyChainGate did not complete" })
    );
  });

  it("is disabled outside review diffs", () => {
    expect(supplyChainReviewEnabled({ mode: "plan", subject: "plan", diff: packageJsonDependencyDiff })).toBe(false);
    expect(supplyChainReviewEnabled({ mode: "review", subject: "empty", diff: "" })).toBe(false);
    expect(
      supplyChainReviewEnabled({ mode: "review", subject: "dependency", diff: packageJsonDependencyDiff }, createDefaultConfig())
    ).toBe(false);
  });
});
