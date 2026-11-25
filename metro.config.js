// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo SQLite on web ships a .wasm file and needs cross-origin isolation headers.
config.resolver.assetExts.push('wasm');

// admin-web/ and instructor-web/ are separate websites (Vite) with their own node_modules:
// keep them out of the mobile bundle.
const webDirs = ['admin-web', 'instructor-web'].map((d) => path.join(__dirname, d).replace(/[/\\]/g, '[/\\\\]'));
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  ...webDirs.map((d) => new RegExp(`^${d}[/\\\\].*`)),
];
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
