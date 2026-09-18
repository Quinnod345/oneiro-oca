/**
 * Screenshot Capture — render HTML code to PNG via Puppeteer.
 *
 * Lazy-initializes a single browser instance and reuses it.
 * Cleans up on process exit.
 *
 *   import { capture, captureBatch, cleanup } from './screenshot-capture.js';
 *   const pngPath = await capture(htmlCode, '/tmp/output.png');
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

let browser = null;

const DEFAULT_VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

// Chrome for Testing 146/147 hang indefinitely on Page.captureScreenshot
// under macOS 26.x — every screenshot times out at the 180s protocolTimeout.
// Chrome 137 is the newest cached build that still composites correctly, so
// prefer it when present. Override with PUPPETEER_EXECUTABLE_PATH if needed.
function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const cacheDir = join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (!existsSync(cacheDir)) return undefined;
  const builds = readdirSync(cacheDir)
    .filter(d => d.startsWith('mac_arm-'))
    .map(d => ({ dir: d, major: parseInt(d.split('-')[1]) || 0 }))
    .filter(b => b.major > 0 && b.major <= 145)
    .sort((a, b) => b.major - a.major);
  for (const b of builds) {
    const exe = join(cacheDir, b.dir, 'chrome-mac-arm64',
      'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 45000,
      executablePath: resolveChromePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    // Cleanup on exit
    const cleanup = async () => {
      if (browser) { try { await browser.close(); } catch {} browser = null; }
    };
    process.on('exit', () => { try { browser?.close(); } catch {} });
    process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
    process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
  }
  return browser;
}

/**
 * Render HTML code to a PNG screenshot.
 *
 * @param {string} html - Raw HTML code (or file:// path)
 * @param {string} outputPath - Where to save the PNG
 * @param {object} options - { width, height, deviceScaleFactor, waitMs }
 * @returns {string} The output path
 */
export async function capture(html, outputPath, options = {}) {
  const { width, height, deviceScaleFactor, waitMs } = {
    ...DEFAULT_VIEWPORT,
    waitMs: 500,
    ...options,
  };

  // Ensure output directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const b = await getBrowser();
  const page = await b.newPage();
  await page.setViewport({ width, height, deviceScaleFactor });

  if (html.startsWith('file://') || html.startsWith('http')) {
    await page.goto(html, { waitUntil: 'networkidle0', timeout: 15000 });
  } else {
    // Write HTML to temp file and load it (handles relative resources better)
    const tmpPath = `/tmp/design-capture-${Date.now()}.html`;
    writeFileSync(tmpPath, html);
    await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0', timeout: 15000 });
  }

  await new Promise(r => setTimeout(r, waitMs));
  await page.screenshot({ path: outputPath, type: 'png', fullPage: false });
  await page.close();

  return outputPath;
}

/**
 * Render multiple HTML strings to PNGs.
 *
 * @param {Array<{html: string, outputPath: string}>} items
 * @returns {Array<string>} Output paths
 */
export async function captureBatch(items, options = {}) {
  const results = [];
  for (const item of items) {
    try {
      const path = await capture(item.html, item.outputPath, options);
      results.push(path);
    } catch (e) {
      console.error(`[screenshot] failed: ${e.message.slice(0, 60)}`);
      results.push(null);
    }
  }
  return results;
}

/**
 * Close the browser instance.
 */
export async function cleanup() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export default { capture, captureBatch, cleanup };
