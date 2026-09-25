module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    // Drizzle's expo migrations import the generated .sql files as strings.
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
