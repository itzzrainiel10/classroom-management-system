// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo SQLite on web ships a .wasm file and needs cross-origin isolation headers.
config.resolver.assetExts.push('wasm');

// web/ is the separate admin portal (Vite) with its own node_modules: keep it out of the mobile bundle.
const webDir = path.join(__dirname, 'web').replace(/[/\\]/g, '[/\\\\]');
config.resolver.blockList = [...[].concat(config.resolver.blockList ?? []), new RegExp(`^${webDir}[/\\\\].*`)];
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
