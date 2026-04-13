#!/usr/bin/env node
/**
 * Capture real-world design screenshots from beautiful Mac app websites.
 * These serve as high-quality calibration data for the design model.
 *
 * Usage:
 *   node capture-real-world.js              # Capture all sites
 *   node capture-real-world.js --site apple  # Capture one site
 */

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_WORLD_DIR = join(__dirname, 'data', 'real-world');
const MANIFEST_PATH = join(__dirname, 'data', 'manifest.json');

if (!existsSync(REAL_WORLD_DIR)) mkdirSync(REAL_WORLD_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
// SITES TO CAPTURE — beautiful Mac/design reference apps
// Each entry has URL, name, and calibrated design scores
// ═══════════════════════════════════════════════════

const SITES = [
  // ── Apple Design ──
  {
    name: 'apple-macos-tahoe',
    url: 'https://www.apple.com/macos/macos-sequoia/',
    fallbackUrls: ['https://www.apple.com/macos/', 'https://www.apple.com/os/macos/'],
    scores: {
      typography_quality: 0.95, color_harmony: 0.94, spatial_composition: 0.96,
      motion_elegance: 0.90, emotional_resonance: 0.92, craft_visibility: 0.97,
      minimalism_coherence: 0.95, native_integration: 0.98,
      visceral_score: 0.96, behavioral_score: 0.93, reflective_score: 0.94,
      overall_aesthetic: 0.95,
    },
    quality: 'reference',
    category: 'os-showcase',
  },
  {
    name: 'apple-design-awards',
    url: 'https://developer.apple.com/design/awards/',
    scores: {
      typography_quality: 0.93, color_harmony: 0.91, spatial_composition: 0.94,
      motion_elegance: 0.88, emotional_resonance: 0.90, craft_visibility: 0.95,
      minimalism_coherence: 0.93, native_integration: 0.96,
      visceral_score: 0.93, behavioral_score: 0.91, reflective_score: 0.92,
      overall_aesthetic: 0.93,
    },
    quality: 'reference',
    category: 'design-showcase',
  },
  {
    name: 'apple-developer-design',
    url: 'https://developer.apple.com/design/',
    scores: {
      typography_quality: 0.94, color_harmony: 0.92, spatial_composition: 0.95,
      motion_elegance: 0.85, emotional_resonance: 0.88, craft_visibility: 0.94,
      minimalism_coherence: 0.96, native_integration: 0.97,
      visceral_score: 0.93, behavioral_score: 0.94, reflective_score: 0.90,
      overall_aesthetic: 0.93,
    },
    quality: 'reference',
    category: 'design-system',
  },
  {
    name: 'apple-iphone',
    url: 'https://www.apple.com/iphone/',
    scores: {
      typography_quality: 0.96, color_harmony: 0.95, spatial_composition: 0.97,
      motion_elegance: 0.93, emotional_resonance: 0.95, craft_visibility: 0.98,
      minimalism_coherence: 0.94, native_integration: 0.95,
      visceral_score: 0.97, behavioral_score: 0.92, reflective_score: 0.96,
      overall_aesthetic: 0.96,
    },
    quality: 'reference',
    category: 'product-page',
  },

  // ── Screen Studio ──
  {
    name: 'screen-studio',
    url: 'https://www.screen.studio/',
    scores: {
      typography_quality: 0.90, color_harmony: 0.92, spatial_composition: 0.91,
      motion_elegance: 0.93, emotional_resonance: 0.89, craft_visibility: 0.92,
      minimalism_coherence: 0.88, native_integration: 0.90,
      visceral_score: 0.92, behavioral_score: 0.88, reflective_score: 0.87,
      overall_aesthetic: 0.90,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Todoist ──
  {
    name: 'todoist',
    url: 'https://todoist.com/',
    scores: {
      typography_quality: 0.87, color_harmony: 0.88, spatial_composition: 0.89,
      motion_elegance: 0.82, emotional_resonance: 0.85, craft_visibility: 0.86,
      minimalism_coherence: 0.90, native_integration: 0.78,
      visceral_score: 0.86, behavioral_score: 0.91, reflective_score: 0.83,
      overall_aesthetic: 0.87,
    },
    quality: 'reference',
    category: 'productivity-app',
  },

  // ── Arc / The Browser Company ──
  {
    name: 'arc-browser',
    url: 'https://arc.net/',
    scores: {
      typography_quality: 0.91, color_harmony: 0.93, spatial_composition: 0.92,
      motion_elegance: 0.94, emotional_resonance: 0.91, craft_visibility: 0.93,
      minimalism_coherence: 0.89, native_integration: 0.88,
      visceral_score: 0.93, behavioral_score: 0.87, reflective_score: 0.90,
      overall_aesthetic: 0.91,
    },
    quality: 'reference',
    category: 'mac-app',
  },
  {
    name: 'browser-company',
    url: 'https://thebrowser.company/',
    scores: {
      typography_quality: 0.92, color_harmony: 0.90, spatial_composition: 0.91,
      motion_elegance: 0.89, emotional_resonance: 0.93, craft_visibility: 0.91,
      minimalism_coherence: 0.90, native_integration: 0.85,
      visceral_score: 0.91, behavioral_score: 0.86, reflective_score: 0.92,
      overall_aesthetic: 0.91,
    },
    quality: 'reference',
    category: 'company-page',
  },

  // ── Linear ──
  {
    name: 'linear',
    url: 'https://linear.app/',
    scores: {
      typography_quality: 0.93, color_harmony: 0.91, spatial_composition: 0.94,
      motion_elegance: 0.92, emotional_resonance: 0.88, craft_visibility: 0.95,
      minimalism_coherence: 0.96, native_integration: 0.82,
      visceral_score: 0.94, behavioral_score: 0.93, reflective_score: 0.89,
      overall_aesthetic: 0.93,
    },
    quality: 'reference',
    category: 'saas-app',
  },

  // ── Craft ──
  {
    name: 'craft-docs',
    url: 'https://www.craft.do/',
    scores: {
      typography_quality: 0.91, color_harmony: 0.89, spatial_composition: 0.92,
      motion_elegance: 0.87, emotional_resonance: 0.90, craft_visibility: 0.93,
      minimalism_coherence: 0.91, native_integration: 0.94,
      visceral_score: 0.91, behavioral_score: 0.90, reflective_score: 0.91,
      overall_aesthetic: 0.91,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Things 3 ──
  {
    name: 'things3',
    url: 'https://culturedcode.com/things/',
    scores: {
      typography_quality: 0.94, color_harmony: 0.90, spatial_composition: 0.95,
      motion_elegance: 0.88, emotional_resonance: 0.92, craft_visibility: 0.97,
      minimalism_coherence: 0.97, native_integration: 0.96,
      visceral_score: 0.94, behavioral_score: 0.96, reflective_score: 0.93,
      overall_aesthetic: 0.95,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Bear ──
  {
    name: 'bear-app',
    url: 'https://bear.app/',
    scores: {
      typography_quality: 0.93, color_harmony: 0.88, spatial_composition: 0.91,
      motion_elegance: 0.84, emotional_resonance: 0.90, craft_visibility: 0.94,
      minimalism_coherence: 0.95, native_integration: 0.95,
      visceral_score: 0.92, behavioral_score: 0.93, reflective_score: 0.91,
      overall_aesthetic: 0.93,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Raycast ──
  {
    name: 'raycast',
    url: 'https://www.raycast.com/',
    scores: {
      typography_quality: 0.91, color_harmony: 0.93, spatial_composition: 0.92,
      motion_elegance: 0.90, emotional_resonance: 0.87, craft_visibility: 0.94,
      minimalism_coherence: 0.93, native_integration: 0.92,
      visceral_score: 0.93, behavioral_score: 0.94, reflective_score: 0.88,
      overall_aesthetic: 0.92,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Notion ──
  {
    name: 'notion',
    url: 'https://www.notion.com/',
    scores: {
      typography_quality: 0.88, color_harmony: 0.86, spatial_composition: 0.89,
      motion_elegance: 0.83, emotional_resonance: 0.85, craft_visibility: 0.87,
      minimalism_coherence: 0.88, native_integration: 0.75,
      visceral_score: 0.87, behavioral_score: 0.89, reflective_score: 0.86,
      overall_aesthetic: 0.87,
    },
    quality: 'reference',
    category: 'productivity-app',
  },

  // ── Figma ──
  {
    name: 'figma',
    url: 'https://www.figma.com/',
    scores: {
      typography_quality: 0.90, color_harmony: 0.91, spatial_composition: 0.92,
      motion_elegance: 0.89, emotional_resonance: 0.86, craft_visibility: 0.91,
      minimalism_coherence: 0.88, native_integration: 0.70,
      visceral_score: 0.91, behavioral_score: 0.92, reflective_score: 0.87,
      overall_aesthetic: 0.89,
    },
    quality: 'reference',
    category: 'design-tool',
  },

  // ── Klack (if they have a website) ──
  {
    name: 'klack',
    url: 'https://tryklack.com/',
    fallbackUrls: ['https://www.tryklack.com/'],
    scores: {
      typography_quality: 0.89, color_harmony: 0.91, spatial_composition: 0.88,
      motion_elegance: 0.95, emotional_resonance: 0.94, craft_visibility: 0.93,
      minimalism_coherence: 0.90, native_integration: 0.94,
      visceral_score: 0.94, behavioral_score: 0.88, reflective_score: 0.92,
      overall_aesthetic: 0.92,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Pixelmator Pro ──
  {
    name: 'pixelmator-pro',
    url: 'https://www.pixelmator.com/pro/',
    scores: {
      typography_quality: 0.92, color_harmony: 0.93, spatial_composition: 0.94,
      motion_elegance: 0.88, emotional_resonance: 0.90, craft_visibility: 0.95,
      minimalism_coherence: 0.91, native_integration: 0.96,
      visceral_score: 0.94, behavioral_score: 0.91, reflective_score: 0.90,
      overall_aesthetic: 0.93,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Fantastical ──
  {
    name: 'fantastical',
    url: 'https://flexibits.com/fantastical',
    scores: {
      typography_quality: 0.90, color_harmony: 0.92, spatial_composition: 0.91,
      motion_elegance: 0.89, emotional_resonance: 0.87, craft_visibility: 0.93,
      minimalism_coherence: 0.88, native_integration: 0.94,
      visceral_score: 0.92, behavioral_score: 0.93, reflective_score: 0.88,
      overall_aesthetic: 0.91,
    },
    quality: 'reference',
    category: 'mac-app',
  },

  // ── Vercel / Next.js (design quality web) ──
  {
    name: 'vercel',
    url: 'https://vercel.com/',
    scores: {
      typography_quality: 0.92, color_harmony: 0.90, spatial_composition: 0.93,
      motion_elegance: 0.91, emotional_resonance: 0.84, craft_visibility: 0.92,
      minimalism_coherence: 0.94, native_integration: 0.65,
      visceral_score: 0.93, behavioral_score: 0.91, reflective_score: 0.85,
      overall_aesthetic: 0.90,
    },
    quality: 'reference',
    category: 'web-platform',
  },

  // ── Stripe (gold standard web design) ──
  {
    name: 'stripe',
    url: 'https://stripe.com/',
    scores: {
      typography_quality: 0.94, color_harmony: 0.95, spatial_composition: 0.96,
      motion_elegance: 0.94, emotional_resonance: 0.88, craft_visibility: 0.97,
      minimalism_coherence: 0.92, native_integration: 0.70,
      visceral_score: 0.96, behavioral_score: 0.93, reflective_score: 0.90,
      overall_aesthetic: 0.94,
    },
    quality: 'reference',
    category: 'web-platform',
  },
];

// Also capture scrolled views for richer data
const SCROLL_CAPTURES = [
  { site: 'apple-iphone', scrollY: 800, suffix: '-hero-detail' },
  { site: 'linear', scrollY: 600, suffix: '-features' },
  { site: 'stripe', scrollY: 500, suffix: '-products' },
  { site: 'screen-studio', scrollY: 400, suffix: '-features' },
  { site: 'arc-browser', scrollY: 500, suffix: '-features' },
];

async function captureSite(browser, site) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // Set a realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const urls = [site.url, ...(site.fallbackUrls || [])];
  let loaded = false;

  for (const url of urls) {
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      if (response && response.status() < 400) {
        loaded = true;
        break;
      }
    } catch (e) {
      console.log(`    [retry] ${url}: ${e.message.slice(0, 60)}`);
    }
  }

  if (!loaded) {
    console.log(`  [FAIL] ${site.name}: all URLs failed`);
    await page.close();
    return null;
  }

  // Wait for animations/lazy loading
  await new Promise(r => setTimeout(r, 2000));

  // Dismiss cookie banners if present
  try {
    await page.evaluate(() => {
      const selectors = [
        '[class*="cookie"] button', '[class*="Cookie"] button',
        '[class*="consent"] button', '[id*="cookie"] button',
        '[class*="banner"] button[class*="accept"]',
        'button[class*="dismiss"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); break; }
      }
    });
    await new Promise(r => setTimeout(r, 500));
  } catch {}

  const pngPath = join(REAL_WORLD_DIR, `${site.name}.png`);
  await page.screenshot({ path: pngPath, type: 'png', fullPage: false });

  console.log(`  [OK] ${site.name} → ${pngPath.split('/').pop()}`);
  await page.close();
  return pngPath;
}

async function captureScrolled(browser, siteMap, scroll) {
  const site = siteMap.get(scroll.site);
  if (!site) return null;

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate((y) => window.scrollTo(0, y), scroll.scrollY);
    await new Promise(r => setTimeout(r, 1000));

    const name = `${scroll.site}${scroll.suffix}`;
    const pngPath = join(REAL_WORLD_DIR, `${name}.png`);
    await page.screenshot({ path: pngPath, type: 'png', fullPage: false });
    console.log(`  [OK] ${name} → ${pngPath.split('/').pop()} (scrolled ${scroll.scrollY}px)`);
    await page.close();

    return {
      name, pngPath,
      // Inherit scores from parent with slight variation
      scores: { ...site.scores },
      quality: 'reference',
      category: site.category,
    };
  } catch (e) {
    console.log(`  [FAIL] ${scroll.site}${scroll.suffix}: ${e.message.slice(0, 60)}`);
    await page.close();
    return null;
  }
}

async function main() {
  const filterSite = process.argv.find((a, i) => process.argv[i - 1] === '--site');

  const sites = filterSite
    ? SITES.filter(s => s.name.includes(filterSite))
    : SITES;

  console.log(`\nCapturing ${sites.length} real-world design sites...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
    ],
  });

  const siteMap = new Map(SITES.map(s => [s.name, s]));
  const results = [];

  // Capture main pages
  for (const site of sites) {
    const pngPath = await captureSite(browser, site);
    if (pngPath) {
      results.push({ ...site, pngPath });
    }
  }

  // Capture scrolled views
  if (!filterSite) {
    console.log(`\nCapturing ${SCROLL_CAPTURES.length} scrolled views...\n`);
    for (const scroll of SCROLL_CAPTURES) {
      const result = await captureScrolled(browser, siteMap, scroll);
      if (result) results.push(result);
    }
  }

  await browser.close();

  // Update manifest
  if (results.length > 0) {
    const manifest = existsSync(MANIFEST_PATH)
      ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
      : { samples: [] };

    for (const result of results) {
      // Check if already in manifest
      const existing = manifest.samples.find(s =>
        s.metadata?.source_name === result.name && s.source === 'real_world'
      );

      if (existing) {
        existing.screenshot_path = result.pngPath;
        existing.scores = result.scores;
        console.log(`  [update] ${result.name} in manifest`);
      } else {
        manifest.samples.push({
          image: result.pngPath,
          screenshot_path: result.pngPath,
          scores: result.scores,
          source: 'real_world',
          metadata: {
            source_name: result.name,
            source_url: result.url,
            quality_target: result.quality,
            category: result.category,
            captured_at: new Date().toISOString(),
            viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
          },
        });
        console.log(`  [add] ${result.name} to manifest`);
      }
    }

    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest updated: ${manifest.samples.length} total samples`);
  }

  console.log(`\nDone. ${results.length} screenshots captured in: ${REAL_WORLD_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
