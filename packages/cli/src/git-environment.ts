/** Bind local Git queries to their explicit cwd, independent of a parent hook. */
export function isolatedGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_/i.test(key)));
  return {
    ...env,
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    // Git also maps /dev/null to NUL on Windows; the Node device path is not a config path.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
}
