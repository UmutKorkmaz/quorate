/**
 * GitHub App server entry point.
 *
 * Exports the public API surface for consumers and programmatic use,
 * then starts the HTTP server when invoked directly.
 */

export type { AppDeps, AppOctokit, CheckRunResult, CheckRunConclusion } from "./review.js";
export { reviewPullRequest } from "./review.js";
export { startServer } from "./server.js";
