/**
 * Build script for cross-browser extension packaging.
 * 
 * Usage:
 *   node scripts/build.js chrome   - Build for Chrome
 *   node scripts/build.js firefox  - Build for Firefox
 *   node scripts/build.js all      - Build for both
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BROWSERS = ['chrome', 'firefox'];

/**
 * Files to copy for each browser build.
 */
const COMMON_FILES = [
  'src/content/content.js',
  'src/popup/popup.html',
  'src/popup/popup.js',
  'src/popup/popup.css',
  'src/popup/icon.svg',
  'src/lib/constants.js',
  'src/lib/settings.js',
  'src/lib/audio-utils.js',
  'src/lib/audio-processor.js',
  'src/lib/browser-compat.js',
  'assets/icons/icon16.png',
  'assets/icons/icon48.png',
  'assets/icons/icon128.png',
  'node_modules/webextension-polyfill/dist/browser-polyfill.min.js'
];

const CHROME_FILES = [
  'src/background/service-worker.js',
  'src/offscreen/offscreen.html',
  'src/offscreen/offscreen.js'
];

const FIREFOX_FILES = [
  'src/background/background-firefox.js',
  'src/content/content-firefox.js'
];

/**
 * Ensures directory exists.
 * @param {string} dir - Directory path
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copies a file preserving directory structure.
 * @param {string} src - Source path
 * @param {string} destDir - Destination directory
 */
function copyFile(src, destDir) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(destDir, src);
  
  if (!fs.existsSync(srcPath)) {
    console.warn(`  Warning: ${src} not found, skipping`);
    return;
  }
  
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
  console.log(`  Copied: ${src}`);
}

/**
 * Builds extension for a specific browser.
 * @param {string} browser - 'chrome' or 'firefox'
 */
function build(browser) {
  console.log(`\nBuilding for ${browser}...`);
  
  const distDir = path.join(ROOT, 'dist', browser);
  
  // Clean previous build
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
  }
  ensureDir(distDir);
  
  // Copy manifest
  const manifestSrc = path.join(ROOT, `manifest.${browser}.json`);
  const manifestDest = path.join(distDir, 'manifest.json');
  fs.copyFileSync(manifestSrc, manifestDest);
  console.log(`  Copied: manifest.${browser}.json -> manifest.json`);
  
  // Copy common files
  COMMON_FILES.forEach(file => copyFile(file, distDir));
  
  // Copy browser-specific files
  const browserFiles = browser === 'chrome' ? CHROME_FILES : FIREFOX_FILES;
  browserFiles.forEach(file => copyFile(file, distDir));
  
  // Copy polyfill to lib folder for easier access
  const polyfillSrc = path.join(ROOT, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js');
  const polyfillDest = path.join(distDir, 'src/lib/browser-polyfill.min.js');
  if (fs.existsSync(polyfillSrc)) {
    ensureDir(path.dirname(polyfillDest));
    fs.copyFileSync(polyfillSrc, polyfillDest);
  }
  
  console.log(`\n✓ ${browser} build complete: dist/${browser}/`);
}

// Main
const args = process.argv.slice(2);
const target = args[0] || 'all';

if (target === 'all') {
  BROWSERS.forEach(build);
} else if (BROWSERS.includes(target)) {
  build(target);
} else {
  console.error(`Unknown target: ${target}`);
  console.error(`Usage: node scripts/build.js [chrome|firefox|all]`);
  process.exit(1);
}
