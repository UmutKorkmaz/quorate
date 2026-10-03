/** Bind Git queries to explicit cwd; retain normal machine line-ending settings. */
export function isolatedGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_/i.test(key)));
  return {
    ...env,
    GIT_CONFIG_COUNT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}
