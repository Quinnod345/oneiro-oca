#!/usr/bin/env node
/**
 * Scrape public design galleries for high-quality UI screenshots.
 * Sources: Dribbble, landing page galleries, design award winners,
 * app store marketing, and design system showcases.
 *
 * Usage: node scrape-galleries.js
 */

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const GALLERY_DIR = join(DATA_DIR, 'galleries');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');

if (!existsSync(GALLERY_DIR)) mkdirSync(GALLERY_DIR, { recursive: true });

// ═══════════════════════════════════════════════════
// GALLERY SITES — publicly accessible, no login required
// ═══════════════════════════════════════════════════

const GALLERIES = [
  // Landing page galleries
  { name: 'landingfolio', url: 'https://www.landingfolio.com/', scrolls: [600, 1200], tier: 'excellent', category: 'gallery' },
  { name: 'saaspages', url: 'https://saaspages.xyz/', scrolls: [500], tier: 'excellent', category: 'gallery' },
  { name: 'onepagelove', url: 'https://onepagelove.com/', scrolls: [400], tier: 'excellent', category: 'gallery' },
  { name: 'godly', url: 'https://godly.website/', scrolls: [500, 1000], tier: 'exceptional', category: 'gallery' },
  { name: 'httpster', url: 'https://httpster.net/', tier: 'excellent', category: 'gallery' },

  // Design system showcases
  { name: 'designsystems-gallery', url: 'https://designsystemsrepo.com/design-systems/', tier: 'excellent', category: 'design-system' },
  { name: 'component-gallery', url: 'https://component.gallery/', tier: 'excellent', category: 'component' },

  // Award winners
  { name: 'css-design-awards', url: 'https://www.cssdesignawards.com/', scrolls: [500], tier: 'exceptional', category: 'awards' },
  { name: 'siteinspire', url: 'https://www.siteinspire.com/', scrolls: [600], tier: 'exceptional', category: 'gallery' },

  // Beautiful product pages
  { name: 'apple-vision-pro', url: 'https://www.apple.com/apple-vision-pro/', scrolls: [800, 1600], tier: 'exceptional', category: 'product' },
  { name: 'apple-macbook-pro', url: 'https://www.apple.com/macbook-pro/', scrolls: [800, 1600], tier: 'exceptional', category: 'product' },
  { name: 'nothing-phone', url: 'https://nothing.tech/pages/phone-2a-plus', tier: 'excellent', category: 'product' },
  { name: 'teenage-engineering', url: 'https://teenage.engineering/', scrolls: [500], tier: 'exceptional', category: 'product' },
  { name: 'rivian', url: 'https://rivian.com/', scrolls: [600], tier: 'excellent', category: 'product' },

  // Innovative web experiences
  { name: 'linear-changelog', url: 'https://linear.app/changelog', scrolls: [500], tier: 'exceptional', category: 'changelog' },
  { name: 'stripe-sessions', url: 'https://stripe.com/sessions', tier: 'excellent', category: 'event' },
  { name: 'vercel-ship', url: 'https://vercel.com/ship', tier: 'excellent', category: 'event' },
  { name: 'openai', url: 'https://openai.com/', scrolls: [500, 1000], tier: 'excellent', category: 'ai' },
  { name: 'anthropic', url: 'https://www.anthropic.com/', scrolls: [600], tier: 'excellent', category: 'ai' },

  // Beautiful apps / tools
  { name: 'arc-max', url: 'https://arc.net/max', tier: 'exceptional', category: 'feature' },
  { name: 'notion-ai', url: 'https://www.notion.com/product/ai', scrolls: [500], tier: 'excellent', category: 'feature' },
  { name: 'figma-dev-mode', url: 'https://www.figma.com/dev-mode/', scrolls: [600], tier: 'exceptional', category: 'feature' },
  { name: 'raycast-pro', url: 'https://www.raycast.com/pro', scrolls: [400], tier: 'excellent', category: 'feature' },
  { name: 'superhuman', url: 'https://superhuman.com/', scrolls: [500], tier: 'exceptional', category: 'productivity' },
  { name: 'mercury', url: 'https://mercury.com/', scrolls: [600], tier: 'excellent', category: 'fintech' },
  { name: 'ramp', url: 'https://ramp.com/', scrolls: [500], tier: 'excellent', category: 'fintech' },

  // Design tool landing pages
  { name: 'webflow', url: 'https://webflow.com/', scrolls: [600], tier: 'excellent', category: 'design-tool' },
  { name: 'cursor', url: 'https://cursor.com/', scrolls: [500], tier: 'excellent', category: 'devtools' },
  { name: 'warp', url: 'https://www.warp.dev/', scrolls: [500], tier: 'excellent', category: 'devtools' },
  { name: 'zed', url: 'https://zed.dev/', scrolls: [500], tier: 'excellent', category: 'devtools' },
];

const TIER_SCORES = {
  exceptional: () => {
    const base = 0.82 + Math.random() * 0.15;
    return { overall_aesthetic: base, innovation_score: 0.55 + Math.random() * 0.3 };
  },
  excellent: () => {
    const base = 0.72 + Math.random() * 0.15;
    return { overall_aesthetic: base, innovation_score: 0.4 + Math.random() * 0.25 };
  },
};

async function scrapeGallery(browser, site) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['media', 'font'].includes(req.resourceType())) req.abort();
    else req.continue();
  });

  try {
    await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 25000 });
  } catch (e) {
    console.log(`  [FAIL] ${site.name}: ${e.message.slice(0, 50)}`);
    await page.close();
    return [];
  }

  await new Promise(r => setTimeout(r, 2000));

  // Dismiss cookie banners
  try {
    await page.evaluate(() => {
      const sels = ['[class*="cookie"] button', '[class*="consent"] button', 'button[class*="accept"]'];
      for (const s of sels) { const b = document.querySelector(s); if (b) { b.click(); break; } }
    });
    await new Promise(r => setTimeout(r, 500));
  } catch {}

  const screenshots = [];

  // Main viewport
  const mainPath = join(GALLERY_DIR, `${site.name}.png`);
  await page.screenshot({ path: mainPath, type: 'png', fullPage: false });
  screenshots.push({ path: mainPath, scroll: 0 });

  // Scrolled views
  for (const y of (site.scrolls || [])) {
    await page.evaluate(scrollY => window.scrollTo(0, scrollY), y);
    await new Promise(r => setTimeout(r, 800));
    const scrollPath = join(GALLERY_DIR, `${site.name}-scroll-${y}.png`);
    await page.screenshot({ path: scrollPath, type: 'png', fullPage: false });
    screenshots.push({ path: scrollPath, scroll: y });
  }

  // Extract HTML+CSS for code features
  const html = await page.content();
  const css = await page.evaluate(() => {
    return [...document.styleSheets].map(s => {
      try { return [...s.cssRules].map(r => r.cssText).join('\n'); }
      catch { return ''; }
    }).join('\n');
  });

  await page.close();

  // Build samples
  const samples = screenshots.map(ss => {
    const tierScores = (TIER_SCORES[site.tier] || TIER_SCORES.excellent)();
    // Generate all 16 dim scores based on tier
    const base = tierScores.overall_aesthetic;
    const innov = tierScores.innovation_score;
    const jitter = () => (Math.random() - 0.5) * 0.08;

    return {
      image: ss.path,
      screenshot_path: ss.path,
      scores: {
        typography_quality: base + jitter(), color_harmony: base + jitter(),
        spatial_composition: base + jitter(), motion_elegance: base - 0.05 + jitter(),
        emotional_resonance: base + jitter(), craft_visibility: base + jitter(),
        minimalism_coherence: base + jitter(), native_integration: base - 0.1 + jitter(),
        visceral_score: base + jitter(), behavioral_score: base + jitter(),
        reflective_score: base + jitter(), overall_aesthetic: base,
        innovation_score: innov, system_creativity: innov - 0.05 + jitter(),
        design_distinctiveness: innov + jitter(), problem_level: innov - 0.1 + jitter(),
      },
      source: 'scraped_gallery',
      metadata: {
        source_name: `${site.name}${ss.scroll ? `-scroll-${ss.scroll}` : ''}`,
        source_url: site.url,
        quality_target: site.tier,
        category: site.category,
        scraped_at: new Date().toISOString(),
      },
    };
  });

  const totalShots = screenshots.length;
  console.log(`  [OK] ${site.name} (${site.tier}) | ${totalShots} shots`);
  return samples;
}

async function main() {
  console.log(`\nScraping ${GALLERIES.length} design galleries...\n`);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const allSamples = [];

  for (const site of GALLERIES) {
    const samples = await scrapeGallery(browser, site);
    allSamples.push(...samples);
  }

  await browser.close();

  // Update manifest
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    : { samples: [] };

  manifest.samples = manifest.samples.filter(s => s.source !== 'scraped_gallery');
  manifest.samples.push(...allSamples);

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\nScraped: ${allSamples.length} screenshots from ${GALLERIES.length} sites`);
  console.log(`Total manifest: ${manifest.samples.length} samples`);
}

main().catch(e => { console.error(e); process.exit(1); });
