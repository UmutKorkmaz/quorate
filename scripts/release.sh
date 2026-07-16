#!/usr/bin/env bash

set -Eeuo pipefail

MODE="verify"
VERSION=""
RELEASE_BRANCH="${RELEASE_BRANCH:-main}"

usage() {
  cat <<'USAGE'
Usage: scripts/release.sh [--execute] [version]

Without --execute, verifies the merged release candidate and performs no release
side effects. With --execute, creates and pushes the tag, creates the GitHub
Release, and then publishes @quorate/core and quorate to npm in that order.

Examples:
  scripts/release.sh 1.1.0
  CONFIRM_RELEASE=v1.1.0 scripts/release.sh --execute 1.1.0

Environment:
  RELEASE_BRANCH=main         Required release branch (default: main)
  CONFIRM_RELEASE=vX.Y.Z      Required exact confirmation for --execute
  ALLOW_NO_PROVENANCE=1       Allow local npm publish without provenance

Provenance is automatic on GitHub Actions. Local execution fails closed unless
ALLOW_NO_PROVENANCE=1 is explicitly set.
USAGE
}

fail() {
  printf 'release: %s\n' "$*" >&2
  exit 1
}

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

while (($# > 0)); do
  case "$1" in
    --execute)
      MODE="execute"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      fail "unknown option: $1"
      ;;
    *)
      [[ -z "$VERSION" ]] || fail "only one version may be supplied"
      VERSION="$1"
      ;;
  esac
  shift
done

for command in awk git mktemp node npm npx rg shasum sort; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done
if [[ "$MODE" == "execute" ]]; then
  command -v gh >/dev/null 2>&1 || fail "required command is missing: gh"
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run from the Quorate repository"
cd "$ROOT"

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || fail "invalid semantic version: $VERSION"

TAG="v$VERSION"
CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$RELEASE_BRANCH" ]] || fail "release from $RELEASE_BRANCH, not $CURRENT_BRANCH"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean"
git diff --check

for package_json in package.json packages/*/package.json; do
  package_version="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(p.version ?? "")' "$package_json")"
  [[ "$package_version" == "$VERSION" ]] || fail "$package_json is $package_version, expected $VERSION"
done

rg -q "^## \\[$VERSION\\] - " CHANGELOG.md || fail "CHANGELOG.md has no $VERSION section"

run npm ci
run npm audit --audit-level=high
run npm run ci
run npm run typecheck --workspace @quorate/github-app
run npm run build --workspace @quorate/github-app
run npm run build:website

ACTION_BUNDLE="packages/github-action/dist/index.js"
ACTION_HASH_ONE="$(shasum -a 256 "$ACTION_BUNDLE" | awk '{print $1}')"
run npm run build --workspace @quorate/github-action
ACTION_HASH_TWO="$(shasum -a 256 "$ACTION_BUNDLE" | awk '{print $1}')"
[[ "$ACTION_HASH_ONE" == "$ACTION_HASH_TWO" ]] || fail "GitHub Action bundle is not deterministic"
printf 'Action bundle SHA-256: %s\n' "$ACTION_HASH_TWO"

run npm pack --workspace @quorate/core --dry-run
run npm pack --workspace quorate --dry-run
run node packages/cli/dist/index.js --version
run node packages/cli/dist/index.js --help
run node packages/cli/dist/index.js supply-chain scan --help
run node packages/cli/dist/index.js supplychain scan --help

SMOKE_DIR="$(mktemp -d)"
NOTES_FILE=""
cleanup() {
  rm -rf "$SMOKE_DIR"
  [[ -z "$NOTES_FILE" ]] || rm -f "$NOTES_FILE"
}
trap cleanup EXIT

cat >"$SMOKE_DIR/clean.diff" <<'DIFF'
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Release smoke
+No dependency, workflow, container, or publish changes.
DIFF
cat >"$SMOKE_DIR/unsafe.diff" <<'DIFF'
diff --git a/Dockerfile b/Dockerfile
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/Dockerfile
@@ -0,0 +1 @@
+FROM node:22
DIFF

run node packages/cli/dist/index.js --cwd "$SMOKE_DIR" supply-chain scan \
  --diff "$SMOKE_DIR/clean.diff" --json --gate \
  --write-json "$SMOKE_DIR/clean.json" --write-md "$SMOKE_DIR/clean.md"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$SMOKE_DIR/clean.json"
[[ -s "$SMOKE_DIR/clean.md" ]] || fail "clean Markdown smoke output is empty"
[[ -s "$SMOKE_DIR/.quorate/supply-chain/latest.json" ]] || fail "latest supply-chain report was not written"

if node packages/cli/dist/index.js --cwd "$SMOKE_DIR" supply-chain scan \
  --diff "$SMOKE_DIR/unsafe.diff" --json --gate --fail-on medium \
  --write-json "$SMOKE_DIR/unsafe.json" --write-md "$SMOKE_DIR/unsafe.md"; then
  fail "unsafe supply-chain smoke unexpectedly passed"
fi
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); if (!r.findings?.length) process.exit(1)' "$SMOKE_DIR/unsafe.json"

UNTRACKED_REPO="$SMOKE_DIR/untracked-repo"
mkdir -p "$UNTRACKED_REPO"
run git -C "$UNTRACKED_REPO" init --quiet
run git -C "$UNTRACKED_REPO" config user.email release-smoke@quorate.local
run git -C "$UNTRACKED_REPO" config user.name "Quorate release smoke"
printf '{"name":"release-smoke","version":"1.0.0"}\n' >"$UNTRACKED_REPO/package.json"
run git -C "$UNTRACKED_REPO" add package.json
run git -C "$UNTRACKED_REPO" commit --quiet -m baseline
printf 'FROM node:22\n' >"$UNTRACKED_REPO/Dockerfile"

if node packages/cli/dist/index.js --cwd "$UNTRACKED_REPO" supply-chain scan \
  --base HEAD --json --gate --fail-on medium \
  --write-json "$SMOKE_DIR/untracked.json" --write-md "$SMOKE_DIR/untracked.md"; then
  fail "untracked unsafe file unexpectedly passed"
fi
node -e '
  const r=JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (!r.findings?.some((finding) => finding.file === "Dockerfile")) process.exit(1);
' "$SMOKE_DIR/untracked.json"

git diff --check
git diff --exit-code -- "$ACTION_BUNDLE" packages/website/src/generated/commands.md
[[ -z "$(git status --porcelain)" ]] || fail "verification changed the working tree; commit generated artifacts first"

PUBLIC_ACTION_REFS="$(
  rg -n 'UmutKorkmaz/quorate@' \
    README.md docs examples packages/website packages/github-action \
    packages/cli/README.md packages/cli/src/setup-command.ts || true
)"
[[ -n "$PUBLIC_ACTION_REFS" ]] || fail "no public Quorate Action references were found"
UNPINNED_ACTION_REFS="$(
  printf '%s\n' "$PUBLIC_ACTION_REFS" |
    rg -v 'UmutKorkmaz/quorate@[0-9a-fA-F]{40}' || true
)"
if [[ -n "$UNPINNED_ACTION_REFS" ]]; then
  printf '%s\n' "$UNPINNED_ACTION_REFS" >&2
  fail "replace every public Quorate Action reference with the reviewed bundle commit's full SHA before tagging"
fi
PINNED_ACTION_SHAS="$(
  printf '%s\n' "$PUBLIC_ACTION_REFS" |
    rg -o 'UmutKorkmaz/quorate@[0-9a-fA-F]{40}' |
    awk -F@ '{print $2}' |
    sort -u
)"
PINNED_ACTION_SHA_COUNT="$(printf '%s\n' "$PINNED_ACTION_SHAS" | awk 'NF { count += 1 } END { print count + 0 }')"
[[ "$PINNED_ACTION_SHA_COUNT" == "1" ]] || fail "public Action references do not share exactly one reviewed commit SHA"
PINNED_ACTION_SHA="$PINNED_ACTION_SHAS"
git cat-file -e "$PINNED_ACTION_SHA^{commit}" 2>/dev/null || fail "pinned Action commit is unavailable: $PINNED_ACTION_SHA"
git merge-base --is-ancestor "$PINNED_ACTION_SHA" HEAD || fail "pinned Action commit is not an ancestor of the release commit"
PINNED_ACTION_HASH="$(git show "$PINNED_ACTION_SHA:$ACTION_BUNDLE" | shasum -a 256 | awk '{print $1}')"
[[ "$PINNED_ACTION_HASH" == "$ACTION_HASH_TWO" ]] || fail "pinned Action bundle differs from the release bundle"
printf 'Pinned Action commit: %s\n' "$PINNED_ACTION_SHA"
printf 'Pinned Action bundle SHA-256: %s\n' "$PINNED_ACTION_HASH"

if [[ "$MODE" == "verify" ]]; then
  printf '\nRelease candidate %s passed local verification. No tag, release, or package was published.\n' "$TAG"
  exit 0
fi

[[ "${CONFIRM_RELEASE:-}" == "$TAG" ]] || fail "set CONFIRM_RELEASE=$TAG to publish"
rg -q "^## \\[$VERSION\\] - Unreleased$" CHANGELOG.md && fail "replace Unreleased with the release date and commit it"

run gh auth status
if [[ "${GITHUB_ACTIONS:-false}" == "true" ]]; then
  run npm ping
else
  run npm whoami
fi
run git fetch origin "$RELEASE_BRANCH" --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$RELEASE_BRANCH")" ]] || fail "HEAD is not the current origin/$RELEASE_BRANCH"
git rev-parse "$TAG" >/dev/null 2>&1 && fail "local tag already exists: $TAG"
git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 && fail "remote tag already exists: $TAG"
gh release view "$TAG" >/dev/null 2>&1 && fail "GitHub Release already exists: $TAG"
npm view "@quorate/core@$VERSION" version >/dev/null 2>&1 && fail "@quorate/core@$VERSION is already published"
npm view "quorate@$VERSION" version >/dev/null 2>&1 && fail "quorate@$VERSION is already published"

PUBLISH_ARGS=(--access public)
if [[ "${GITHUB_ACTIONS:-false}" == "true" ]]; then
  PUBLISH_ARGS+=(--provenance)
elif [[ "${ALLOW_NO_PROVENANCE:-0}" != "1" ]]; then
  fail "run publishing on GitHub Actions for provenance, or explicitly set ALLOW_NO_PROVENANCE=1"
fi

NOTES_FILE="$(mktemp)"
awk -v version="$VERSION" '
  $0 ~ "^## \\[" version "\\]" { capture=1; next }
  capture && /^## \[/ { exit }
  capture { print }
' CHANGELOG.md >"$NOTES_FILE"
[[ -s "$NOTES_FILE" ]] || fail "release notes could not be extracted from CHANGELOG.md"

run git tag -a "$TAG" -m "Quorate $TAG"
run git push origin "$TAG"
run gh release create "$TAG" --verify-tag --target "$(git rev-parse HEAD)" \
  --title "Quorate $TAG" --notes-file "$NOTES_FILE"
run npm publish --workspace @quorate/core "${PUBLISH_ARGS[@]}"
run npm publish --workspace quorate "${PUBLISH_ARGS[@]}"

[[ "$(npm view "@quorate/core@$VERSION" version)" == "$VERSION" ]] || fail "core package verification failed"
[[ "$(npm view "quorate@$VERSION" version)" == "$VERSION" ]] || fail "CLI package verification failed"

PUBLISHED_CLI=(npm exec --yes --package "quorate@$VERSION" -- quorate)
run "${PUBLISHED_CLI[@]}" --version
run "${PUBLISHED_CLI[@]}" --help
run "${PUBLISHED_CLI[@]}" supply-chain scan --help
run "${PUBLISHED_CLI[@]}" --cwd "$SMOKE_DIR" supply-chain scan \
  --diff "$SMOKE_DIR/clean.diff" --json --gate \
  --write-json "$SMOKE_DIR/published-clean.json" --write-md "$SMOKE_DIR/published-clean.md"
if "${PUBLISHED_CLI[@]}" --cwd "$SMOKE_DIR" supply-chain scan \
  --diff "$SMOKE_DIR/unsafe.diff" --json --gate --fail-on medium \
  --write-json "$SMOKE_DIR/published-unsafe.json" --write-md "$SMOKE_DIR/published-unsafe.md"; then
  fail "published CLI unsafe smoke unexpectedly passed"
fi

printf '\nReleased %s: Git tag, GitHub Release, @quorate/core, and quorate are live.\n' "$TAG"
