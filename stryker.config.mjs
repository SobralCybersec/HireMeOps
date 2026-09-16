export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  testRunnerNodeArgs: [],
  vitest: {
    related: true,
    configFile: "vite.config.ts",
  },
  mutate: [
    "automation/cloud-runner-contract.mjs",
    "automation/cloud/cloud-auth.mjs",
    "automation/cloud/cloud-memory-guard.mjs",
  ],
  reporters: ["clear-text", "json", "html"],
  concurrency: 2,
  ignorePatterns: [".codegraph/**", "automation/captures/**", "reports/**", "dist/**", "target/**"],
  jsonReporter: {
    fileName: "reports/mutation/stryker.json",
  },
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
