import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export interface AppOctokitParams {
  appId: string;
  privateKey: string;
  installationId: number;
}

/**
 * Create an Octokit instance authenticated as a specific App installation.
 * Each webhook event carries its own installationId so we mint a fresh client
 * per event — installation tokens are cached by @octokit/auth-app internally.
 */
export function createInstallationOctokit(params: AppOctokitParams): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: params.appId,
      privateKey: params.privateKey,
      installationId: params.installationId
    }
  });
}
