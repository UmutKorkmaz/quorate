import React from "react";
import { render } from "ink";
import type { QuorateConfig, CouncilMode } from "@quorate/core";
import { App } from "./app.js";

export interface LaunchInkShellOptions {
  cwd: string;
  config: QuorateConfig;
  providers?: string;
  mode?: CouncilMode;
}

export async function launchInkShell(options: LaunchInkShellOptions): Promise<void> {
  const instance = render(
    React.createElement(App, {
      cwd: options.cwd,
      config: options.config,
      providers: options.providers,
      mode: options.mode
    })
  );
  await instance.waitUntilExit();
}
