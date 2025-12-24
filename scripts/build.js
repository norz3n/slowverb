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
 * Gets version from Chrome manifest.
 * @returns {string} Version string
 */
function getVersion() {
  const manifestPath = path.join(ROOT, 'manifest.chrome.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.version;
}

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
  'src/lib/soundtouch.js',
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
  const version = getVersion();
  console.log(`\nBuilding for ${browser} v${version}...`);
  
  const distDir = path.join(ROOT, 'dist', `${browser}-${version}`);
  
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
  
  console.log(`\n✓ ${browser} v${version} build complete: dist/${browser}-${version}/`);
}

/**
 * Creates a zip archive of the build directory.
 * @param {string} browser - 'chrome' or 'firefox'
 */
async function pack(browser) {
  const { execSync } = await import('child_process');
  const version = getVersion();
  const distDir = path.join(ROOT, 'dist', `${browser}-${version}`);
  const zipName = `slowverb-${browser}-${version}.zip`;
  const zipPath = path.join(ROOT, 'dist', zipName);
  
  if (!fs.existsSync(distDir)) {
    console.error(`\n✗ Build directory not found: dist/${browser}-${version}/`);
    console.error(`  Run 'npm run build:${browser}' first`);
    return;
  }
  
  // Remove old zip if exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  console.log(`\nPacking ${browser} v${version}...`);
  
  // Use PowerShell Compress-Archive on Windows
  const srcPattern = path.join(distDir, '*');
  execSync(`powershell -Command "Compress-Archive -Path '${srcPattern}' -DestinationPath '${zipPath}'"`, {
    stdio: 'inherit'
  });
  
  console.log(`✓ Created: dist/${zipName}`);
}

// Main
const args = process.argv.slice(2);
const target = args[0] || 'all';

if (target === 'all') {
  BROWSERS.forEach(build);
} else if (target === 'pack') {
  const packTarget = args[1] || 'all';
  if (packTarget === 'all') {
    (async () => { for (const b of BROWSERS) await pack(b); })();
  } else if (BROWSERS.includes(packTarget)) {
    pack(packTarget);
  } else {
    console.error(`Unknown pack target: ${packTarget}`);
    process.exit(1);
  }
} else if (BROWSERS.includes(target)) {
  build(target);
} else {
  console.error(`Unknown target: ${target}`);
  console.error(`Usage: node scripts/build.js [chrome|firefox|all|pack [chrome|firefox|all]]`);
  process.exit(1);
}
