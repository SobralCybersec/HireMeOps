module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "(^|/)node_modules/" },
    exclude: "(^|/)(dist|coverage|reports|target)/",
  },
};
