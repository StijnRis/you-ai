const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Drizzle migrations (packages/db/drizzle/*.sql) are bundled as text.
config.resolver.sourceExts.push("sql");
// expo-sqlite's web build loads its SQLite engine as a .wasm asset.
config.resolver.assetExts.push("wasm");

// expo-sqlite on web needs SharedArrayBuffer, which browsers only allow on
// cross-origin isolated pages. The production equivalent is public/_headers.
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  return middleware(req, res, next);
};

module.exports = withNativeWind(config, { input: "./global.css" });
