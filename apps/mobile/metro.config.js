const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Drizzle migrations (packages/db/drizzle/*.sql) are bundled as text.
config.resolver.sourceExts.push("sql");
// expo-sqlite's web build loads its SQLite engine as a .wasm asset.
config.resolver.assetExts.push("wasm");

// expo-sqlite on web needs SharedArrayBuffer, which browsers only allow on
// cross-origin isolated pages. The production equivalent is public/_headers.
// Expo serves the HTML before Metro's middleware runs, so set the headers on
// every response of the dev server instead of using enhanceMiddleware.
const { ServerResponse } = require("http");
const writeHead = ServerResponse.prototype.writeHead;
ServerResponse.prototype.writeHead = function (...args) {
  if (!this.headersSent) {
    this.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    this.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  }
  return writeHead.apply(this, args);
};

module.exports = withNativeWind(config, { input: "./global.css" });
