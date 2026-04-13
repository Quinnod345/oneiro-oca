#!/usr/bin/env node
/**
 * Render HTML artifacts to PNG screenshots using Puppeteer.
 * Install: npm install puppeteer (downloads Chromium)
 *
 * Usage:
 *   node render-screenshots.js           # Render all artifacts
 *   node render-screenshots.js --width 1280 --height 800
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const SCREENSHOTS_DIR = join(DATA_DIR, 'screenshots');
const PNGS_DIR = join(DATA_DIR, 'pngs');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');

const WIDTH = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--width') || '1280');
const HEIGHT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--height') || '800');

// Ensure output dir
if (!existsSync(PNGS_DIR)) mkdirSync(PNGS_DIR, { recursive: true });

async function renderWithPuppeteer() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const htmlFiles = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.html'));
  console.log(`Rendering ${htmlFiles.length} HTML files to PNG (${WIDTH}x${HEIGHT})...\n`);

  for (const file of htmlFiles) {
    const htmlPath = join(SCREENSHOTS_DIR, file);
    const pngPath = join(PNGS_DIR, file.replace('.html', '.png'));

    if (existsSync(pngPath)) {
      console.log(`  [skip] ${file} — already rendered`);
      continue;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 15000 });

    // Wait a moment for any CSS animations to settle
    await new Promise(r => setTimeout(r, 500));

    await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
    await page.close();

    console.log(`  [done] ${file} → ${basename(pngPath)}`);
  }

  await browser.close();
  return htmlFiles.length;
}

async function renderWithSafariWebKit() {
  // Fallback: use macOS WebKit via swift CLI to render HTML to PNG
  const htmlFiles = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.html'));
  console.log(`Rendering ${htmlFiles.length} HTML files to PNG via WebKit (${WIDTH}x${HEIGHT})...\n`);

  // Write a Swift script that renders HTML to PNG
  const swiftScript = `
import WebKit
import AppKit

let args = CommandLine.arguments
guard args.count >= 4 else {
    print("Usage: render <html_path> <png_path> <width> <height>")
    exit(1)
}

let htmlPath = args[1]
let pngPath = args[2]
let width = Int(args[3]) ?? 1280
let height = Int(args[4]) ?? 800

let app = NSApplication.shared

class Renderer: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let pngPath: String

    init(htmlPath: String, pngPath: String, width: Int, height: Int) {
        self.pngPath = pngPath
        let config = WKWebViewConfiguration()
        self.webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
        super.init()
        self.webView.navigationDelegate = self

        let htmlURL = URL(fileURLWithPath: htmlPath)
        self.webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            let config = WKSnapshotConfiguration()
            config.rect = webView.bounds
            config.snapshotWidth = NSNumber(value: webView.bounds.width * 2)

            webView.takeSnapshot(with: config) { image, error in
                guard let image = image else {
                    print("Error: \\(error?.localizedDescription ?? "unknown")")
                    exit(1)
                }

                guard let tiffData = image.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: tiffData),
                      let pngData = bitmap.representation(using: .png, properties: [:]) else {
                    print("Error: Could not convert to PNG")
                    exit(1)
                }

                do {
                    try pngData.write(to: URL(fileURLWithPath: self.pngPath))
                    print("OK")
                } catch {
                    print("Error: \\(error)")
                }
                exit(0)
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("Error: \\(error.localizedDescription)")
        exit(1)
    }
}

let renderer = Renderer(htmlPath: htmlPath, pngPath: pngPath, width: width, height: height)
app.run()
`;

  const swiftPath = join(DATA_DIR, '_render.swift');
  writeFileSync(swiftPath, swiftScript);

  // Compile once
  const binaryPath = join(DATA_DIR, '_render');
  console.log('  Compiling WebKit renderer...');
  try {
    execSync(`swiftc -framework WebKit -framework AppKit -o "${binaryPath}" "${swiftPath}" 2>&1`, { timeout: 30000 });
  } catch (e) {
    console.error('  Failed to compile Swift renderer:', e.message);
    console.log('\n  Alternative: Install Puppeteer with: npm install puppeteer');
    return 0;
  }
  console.log('  Compiled.\n');

  let rendered = 0;
  for (const file of htmlFiles) {
    const htmlPath = join(SCREENSHOTS_DIR, file);
    const pngPath = join(PNGS_DIR, file.replace('.html', '.png'));

    if (existsSync(pngPath)) {
      console.log(`  [skip] ${file} — already rendered`);
      continue;
    }

    try {
      const result = execSync(
        `"${binaryPath}" "${htmlPath}" "${pngPath}" ${WIDTH} ${HEIGHT} 2>&1`,
        { timeout: 15000 }
      ).toString().trim();

      if (result === 'OK') {
        console.log(`  [done] ${file} → ${basename(pngPath)}`);
        rendered++;
      } else {
        console.log(`  [fail] ${file}: ${result}`);
      }
    } catch (e) {
      console.log(`  [fail] ${file}: ${e.message?.slice(0, 100)}`);
    }
  }

  // Clean up
  try { execSync(`rm -f "${swiftPath}" "${binaryPath}"`); } catch {}

  return rendered;
}

async function updateManifest() {
  if (!existsSync(MANIFEST_PATH)) return;

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  let updated = 0;

  for (const sample of manifest.samples) {
    // The image field currently points to the HTML file
    const htmlFile = basename(sample.image || '');
    if (!htmlFile.endsWith('.html')) continue;

    const pngFile = htmlFile.replace('.html', '.png');
    const pngPath = join(PNGS_DIR, pngFile);

    if (existsSync(pngPath)) {
      sample.screenshot_path = pngPath;
      sample.metadata = sample.metadata || {};
      sample.metadata.screenshot_width = WIDTH;
      sample.metadata.screenshot_height = HEIGHT;
      updated++;
    }
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nUpdated manifest: ${updated} samples now have screenshot_path`);
}

async function main() {
  let count;

  // Try Puppeteer first (best quality), fall back to WebKit
  try {
    await import('puppeteer');
    count = await renderWithPuppeteer();
  } catch {
    console.log('Puppeteer not available, using macOS WebKit renderer...\n');
    count = await renderWithSafariWebKit();
  }

  if (count > 0) {
    await updateManifest();
  }

  console.log(`\nDone. Screenshots in: ${PNGS_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
