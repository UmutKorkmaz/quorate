# Check an explicit newcomer journey

Run `quorate docs check --manifest examples.json --json`. The manifest is the trust boundary: select and review it before execution. Markdown fences are never executed, and the checker never installs dependencies unless a step explicitly declares the installation argv. Each run gets an owned disposable Git repository and HOME with isolated npm configuration/cache; the original repository and HOME are preserved. Explicit commands execute trusted code and are not an OS security sandbox. Native docs execution supports Linux and macOS. On Windows, `docs check` refuses before creating scratch state or running examples, emits an explicit unsupported diagnostic, and exits `2`. Pure schema/command-metadata validation and read-only evidence inspection remain available. POSIX execution tests are explicitly skipped on Windows, alongside a tested Windows refusal path.

A schemaVersion `1` manifest identifies the full expected `sourceRevision`, `artifact`, optional fixture `files`, and ordered `steps`. Every step needs a unique `id`, direct `argv`, and `expectedExit`. Optional `stdoutIncludes` asserts literal substrings; `expectedJson` checks a recursive JSON subset (arrays match exactly). No shell string is constructed. Placeholders `{workspace}`, `{home}`, `{node}`, and `{manifestDir}` expand within argv arguments. The standalone `{cli}` argument expands to Node plus the explicitly selected entrypoint.

For a source candidate, use `artifact: {"mode":"source-candidate","entrypoint":"../packages/cli/dist/index.js"}` with a path relative to the manifest. For an exact published package, use `artifact: {"mode":"published-package","package":"quorate","version":"1.6.0","entrypoint":"dist/index.js"}` and explicitly install that exact package first. Update the exact version when selecting a new release. Both artifact modes require at least one step whose first argv item is `{cli}`; a placeholder passed to another command as data does not qualify. For published journeys, the checker verifies the installed package name/version and confines the entrypoint to that package. Missing packaged files cannot fall back to source. A local tarball fixture exercises installation mechanics and is not public-distribution evidence.

This ordered step list illustrates the real offline demo journey after selecting the artifact:

```json
[
  {"id":"version","argv":["{cli}","--version"],"expectedExit":0},
  {"id":"help","argv":["{cli}","--help"],"expectedExit":0,"stdoutIncludes":["Usage:"]},
  {"id":"demo","argv":["{cli}","--cwd","{workspace}","setup","demo","{workspace}/demo"],"expectedExit":0,"stdoutIncludes":["BLOCKED:","CORRECTED:","PASSED:"]},
  {"id":"blocked","argv":["{cli}","--cwd","{workspace}/demo","supply-chain","scan","--diff","{workspace}/demo/before.diff","--json","--gate"],"expectedExit":1},
  {"id":"corrected","argv":["{cli}","--cwd","{workspace}/demo","supply-chain","scan","--diff","{workspace}/demo/after.diff","--json","--gate"],"expectedExit":0,"expectedJson":{"findings":[]}}
]
```

For an exact package, prepend an explicit argv step such as `npm install --prefix {workspace} --ignore-scripts --no-audit --no-fund quorate@1.6.0` expressed as a JSON array. The installation uses the disposable HOME and cache. Installation errors stop the journey and leave later checks missing. Expected blocked exits count as passed checks when the observed exit/output matches the manifest.

`documentation: {"path":"README.md","sha256":"<reviewed SHA-256>"}` pins documentation bytes; paths are relative to the manifest. `advertisedOptions: [{"command":"release verify","flags":["--manifest","--json"]}]` compares declared options with metadata generated from the actual Commander program. Renamed/missing options or changed documentation produce a stale freshness result independently of successful functional commands. Omitting freshness assertions reports `unknown` rather than claiming current docs.

Default per-step timeout is `120000` ms, default retained output is `65536` bytes per stream, and the overall deadline is at most `600000` ms. Timeouts, interruption, truncation and failed cleanup remain inconclusive. Fixture paths reject traversal, absolute paths and Git metadata. Output is redacted before saving; manifests and arbitrary command arguments are not copied into reports. Owned cleanup refuses paths with changed ownership markers.

Reports use schemaVersion `1`, kind `docs-check`, under `.quorate/docs/latest.json`. They distinguish source/published selection, functionality and freshness, and retain expected versus observed exits. The local producer remains **unattested**, even when selected checks pass. Exit `0` means the selected journey matched and any configured freshness assertions passed, `1` means an expectation/freshness failure or missing artifact, and `2` means invalid or inconclusive execution.
