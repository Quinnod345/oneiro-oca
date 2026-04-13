#!/usr/bin/env node
/**
 * Design Scraper — Extracts HTML/CSS/JS from beautifully designed websites.
 *
 * For each site:
 *   1. Navigate with Puppeteer
 *   2. Extract full rendered HTML
 *   3. Extract all CSS (inline + external stylesheets)
 *   4. Extract JS architecture signals (frameworks, animations, etc.)
 *   5. Take viewport screenshot (1440x900 @2x)
 *   6. Take scrolled screenshots for depth
 *   7. Compute 64-dim code features via encoder
 *   8. Add to manifest with calibrated design scores
 *
 * Usage:
 *   node scrape-designs.js                    # Scrape all sites
 *   node scrape-designs.js --site stripe      # Scrape one site
 *   node scrape-designs.js --list             # Show site list
 */

import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { encodeFromCode } from './encoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const SCRAPED_DIR = join(DATA_DIR, 'scraped');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');

for (const dir of [SCRAPED_DIR, join(SCRAPED_DIR, 'html'), join(SCRAPED_DIR, 'css'),
                    join(SCRAPED_DIR, 'screenshots')]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ═══════════════════════════════════════════════════
// SITE LIST — beautifully designed websites
// Organized by category with calibrated quality scores
// ═══════════════════════════════════════════════════

const SITES = [
  // ── Apple Ecosystem (gold standard) ──
  { name: 'apple-home', url: 'https://www.apple.com/', tier: 'exceptional', category: 'tech-giant',
    scrolls: [600, 1200] },
  { name: 'apple-iphone', url: 'https://www.apple.com/iphone/', tier: 'exceptional', category: 'product',
    scrolls: [800, 1600, 2400] },
  { name: 'apple-watch', url: 'https://www.apple.com/apple-watch-ultra-2/', tier: 'exceptional', category: 'product',
    scrolls: [600, 1200] },
  { name: 'apple-airpods', url: 'https://www.apple.com/airpods-pro/', tier: 'exceptional', category: 'product',
    scrolls: [800] },
  { name: 'apple-developer-design', url: 'https://developer.apple.com/design/', tier: 'exceptional', category: 'docs' },

  // ── Premium SaaS / Dev Tools ──
  { name: 'stripe', url: 'https://stripe.com/', tier: 'exceptional', category: 'fintech',
    scrolls: [500, 1000] },
  { name: 'stripe-press', url: 'https://press.stripe.com/', tier: 'exceptional', category: 'publishing' },
  { name: 'linear', url: 'https://linear.app/', tier: 'exceptional', category: 'productivity',
    scrolls: [600, 1200] },
  { name: 'vercel', url: 'https://vercel.com/', tier: 'exceptional', category: 'devtools',
    scrolls: [500, 1000] },
  { name: 'supabase', url: 'https://supabase.com/', tier: 'excellent', category: 'devtools',
    scrolls: [600] },
  { name: 'resend', url: 'https://resend.com/', tier: 'excellent', category: 'devtools',
    scrolls: [500] },
  { name: 'clerk', url: 'https://clerk.com/', tier: 'excellent', category: 'devtools',
    scrolls: [500] },
  { name: 'railway', url: 'https://railway.com/', tier: 'excellent', category: 'devtools' },
  { name: 'planetscale', url: 'https://planetscale.com/', tier: 'excellent', category: 'devtools' },
  { name: 'neon', url: 'https://neon.tech/', tier: 'excellent', category: 'devtools',
    scrolls: [500] },

  // ── Mac-Native Apps ──
  { name: 'arc-browser', url: 'https://arc.net/', tier: 'exceptional', category: 'mac-app',
    scrolls: [500] },
  { name: 'browser-company', url: 'https://thebrowser.company/', tier: 'exceptional', category: 'company' },
  { name: 'things3', url: 'https://culturedcode.com/things/', tier: 'exceptional', category: 'mac-app',
    scrolls: [400] },
  { name: 'bear-app', url: 'https://bear.app/', tier: 'exceptional', category: 'mac-app' },
  { name: 'craft-docs', url: 'https://www.craft.do/', tier: 'excellent', category: 'mac-app',
    scrolls: [500] },
  { name: 'raycast', url: 'https://www.raycast.com/', tier: 'excellent', category: 'mac-app',
    scrolls: [600] },
  { name: 'screen-studio', url: 'https://www.screen.studio/', tier: 'excellent', category: 'mac-app',
    scrolls: [400] },
  { name: 'pixelmator', url: 'https://www.pixelmator.com/pro/', tier: 'excellent', category: 'mac-app' },
  { name: 'fantastical', url: 'https://flexibits.com/fantastical', tier: 'excellent', category: 'mac-app' },
  { name: 'klack', url: 'https://tryklack.com/', tier: 'excellent', category: 'mac-app' },
  { name: 'cleanshot', url: 'https://cleanshot.com/', tier: 'excellent', category: 'mac-app' },
  { name: 'spark-mail', url: 'https://sparkmailapp.com/', tier: 'good', category: 'mac-app' },

  // ── Design Tools ──
  { name: 'figma', url: 'https://www.figma.com/', tier: 'exceptional', category: 'design-tool',
    scrolls: [600] },
  { name: 'framer', url: 'https://www.framer.com/', tier: 'exceptional', category: 'design-tool',
    scrolls: [500, 1000] },
  { name: 'spline', url: 'https://spline.design/', tier: 'excellent', category: 'design-tool' },
  { name: 'rive', url: 'https://rive.app/', tier: 'excellent', category: 'design-tool' },
  { name: 'lottiefiles', url: 'https://lottiefiles.com/', tier: 'good', category: 'design-tool' },

  // ── Productivity ──
  { name: 'notion', url: 'https://www.notion.com/', tier: 'good', category: 'productivity',
    scrolls: [500] },
  { name: 'todoist', url: 'https://todoist.com/', tier: 'good', category: 'productivity' },
  { name: 'height', url: 'https://height.app/', tier: 'excellent', category: 'productivity' },
  { name: 'amie', url: 'https://www.amie.so/', tier: 'excellent', category: 'productivity' },
  { name: 'cron', url: 'https://cron.com/', tier: 'excellent', category: 'productivity' },

  // ── Creative / Portfolio Sites ──
  { name: 'awwwards', url: 'https://www.awwwards.com/', tier: 'excellent', category: 'awards',
    scrolls: [500] },
  { name: 'lusion', url: 'https://lusion.co/', tier: 'exceptional', category: 'agency' },
  { name: 'basement-studio', url: 'https://basement.studio/', tier: 'exceptional', category: 'agency' },

  // ── SaaS with great design ──
  { name: 'pitch', url: 'https://pitch.com/', tier: 'excellent', category: 'saas' },
  { name: 'cal-com', url: 'https://cal.com/', tier: 'good', category: 'saas' },
  { name: 'dub', url: 'https://dub.co/', tier: 'excellent', category: 'saas' },
  { name: 'mintlify', url: 'https://mintlify.com/', tier: 'excellent', category: 'docs' },

  // ── E-commerce / Consumer ──
  { name: 'airbnb', url: 'https://www.airbnb.com/', tier: 'excellent', category: 'consumer',
    scrolls: [500] },
  { name: 'spotify-design', url: 'https://spotify.design/', tier: 'excellent', category: 'design-system' },
];

// Score tiers — calibrated based on design quality
const TIER_SCORES = {
  exceptional: {
    typography_quality: [0.90, 0.98], color_harmony: [0.90, 0.97], spatial_composition: [0.92, 0.98],
    motion_elegance: [0.85, 0.96], emotional_resonance: [0.88, 0.96], craft_visibility: [0.92, 0.98],
    minimalism_coherence: [0.88, 0.97], native_integration: [0.80, 0.95],
    visceral_score: [0.90, 0.98], behavioral_score: [0.88, 0.96], reflective_score: [0.87, 0.96],
    overall_aesthetic: [0.90, 0.97],
  },
  excellent: {
    typography_quality: [0.80, 0.92], color_harmony: [0.78, 0.92], spatial_composition: [0.80, 0.93],
    motion_elegance: [0.75, 0.90], emotional_resonance: [0.76, 0.90], craft_visibility: [0.80, 0.93],
    minimalism_coherence: [0.78, 0.92], native_integration: [0.70, 0.88],
    visceral_score: [0.80, 0.93], behavioral_score: [0.78, 0.90], reflective_score: [0.76, 0.90],
    overall_aesthetic: [0.80, 0.92],
  },
  good: {
    typography_quality: [0.70, 0.85], color_harmony: [0.68, 0.85], spatial_composition: [0.70, 0.86],
    motion_elegance: [0.65, 0.82], emotional_resonance: [0.66, 0.83], craft_visibility: [0.68, 0.85],
    minimalism_coherence: [0.68, 0.85], native_integration: [0.60, 0.80],
    visceral_score: [0.70, 0.86], behavioral_score: [0.72, 0.85], reflective_score: [0.66, 0.83],
    overall_aesthetic: [0.70, 0.85],
  },
};

function generateScores(tier) {
  const ranges = TIER_SCORES[tier] || TIER_SCORES.good;
  const scores = {};
  for (const [dim, [lo, hi]] of Object.entries(ranges)) {
    scores[dim] = lo + Math.random() * (hi - lo);
  }
  return scores;
}

// ═══════════════════════════════════════════════════
// SCRAPER
// ═══════════════════════════════════════════════════

async function scrapeSite(browser, site) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Block heavy resources to speed up (keep CSS/JS)
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'media', 'font'].includes(type)) {
      // Allow images for screenshots but abort media/font for speed
      if (type === 'image') req.continue();
      else req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 25000 });
  } catch (e) {
    console.log(`  [FAIL] ${site.name}: ${e.message.slice(0, 60)}`);
    await page.close();
    return null;
  }

  // Wait for animations/lazy content
  await new Promise(r => setTimeout(r, 2000));

  // Dismiss cookie banners
  try {
    await page.evaluate(() => {
      const sels = [
        '[class*="cookie"] button', '[class*="consent"] button',
        'button[class*="accept"]', 'button[class*="dismiss"]',
        '[id*="cookie"] button', '[class*="banner"] button',
      ];
      for (const s of sels) {
        const btn = document.querySelector(s);
        if (btn && btn.offsetParent !== null) { btn.click(); break; }
      }
    });
    await new Promise(r => setTimeout(r, 500));
  } catch {}

  // ── Extract HTML ──
  const html = await page.content();

  // ── Extract all CSS (computed + stylesheets) ──
  const cssData = await page.evaluate(() => {
    const sheets = [];

    // Inline style elements
    document.querySelectorAll('style').forEach(el => {
      sheets.push({ type: 'inline', css: el.textContent });
    });

    // External stylesheets (if same-origin)
    for (const sheet of document.styleSheets) {
      try {
        const rules = [];
        for (const rule of sheet.cssRules) {
          rules.push(rule.cssText);
        }
        sheets.push({
          type: 'external',
          href: sheet.href,
          css: rules.join('\n'),
        });
      } catch {
        // Cross-origin sheets can't be read
        sheets.push({ type: 'external', href: sheet.href, css: '/* cross-origin */' });
      }
    }

    // Extract computed styles from key elements for design analysis
    const keyElements = [
      'body', 'h1', 'h2', 'h3', 'p', 'a', 'button',
      'nav', 'header', 'main', 'section', 'footer',
      '[class*="hero"]', '[class*="card"]', '[class*="container"]',
    ];

    const computedStyles = {};
    for (const sel of keyElements) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = window.getComputedStyle(el);
      computedStyles[sel] = {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        transition: cs.transition,
        animation: cs.animation,
      };
    }

    return { sheets, computedStyles };
  });

  // ── Extract JS architecture signals ──
  const jsSignals = await page.evaluate(() => {
    const signals = {
      frameworks: [],
      hasAnimations: false,
      hasTransitions: false,
      hasSmoothScroll: false,
      hasIntersectionObserver: false,
      hasWebGL: false,
      hasServiceWorker: false,
      customElements: [],
    };

    // Detect frameworks
    if (window.__NEXT_DATA__) signals.frameworks.push('nextjs');
    if (window.__NUXT__) signals.frameworks.push('nuxt');
    if (document.querySelector('[data-reactroot]') || document.querySelector('#__next')) signals.frameworks.push('react');
    if (document.querySelector('[data-v-]')) signals.frameworks.push('vue');
    if (document.querySelector('script[src*="svelte"]')) signals.frameworks.push('svelte');
    if (document.querySelector('[data-astro]')) signals.frameworks.push('astro');
    if (window.gsap || document.querySelector('script[src*="gsap"]')) signals.frameworks.push('gsap');
    if (window.Lenis || document.querySelector('script[src*="lenis"]')) signals.frameworks.push('lenis');
    if (document.querySelector('script[src*="framer-motion"]')) signals.frameworks.push('framer-motion');
    if (document.querySelector('script[src*="three"]') || document.querySelector('canvas')) signals.frameworks.push('threejs');

    // Animation signals
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const cs = window.getComputedStyle(el);
      if (cs.animation && cs.animation !== 'none') signals.hasAnimations = true;
      if (cs.transition && cs.transition !== 'all 0s ease 0s') signals.hasTransitions = true;
      if (signals.hasAnimations && signals.hasTransitions) break;
    }

    signals.hasSmoothScroll = getComputedStyle(document.documentElement).scrollBehavior === 'smooth';
    signals.hasWebGL = !!document.querySelector('canvas');

    // Custom elements
    signals.customElements = [...new Set(
      [...document.querySelectorAll('*')]
        .map(el => el.tagName.toLowerCase())
        .filter(tag => tag.includes('-'))
    )].slice(0, 20);

    return signals;
  });

  // ── Save HTML ──
  const htmlPath = join(SCRAPED_DIR, 'html', `${site.name}.html`);
  writeFileSync(htmlPath, html);

  // ── Save CSS ──
  const allCss = cssData.sheets.map(s => s.css).join('\n\n');
  const cssPath = join(SCRAPED_DIR, 'css', `${site.name}.css`);
  writeFileSync(cssPath, allCss);

  // ── Take screenshots ──
  const screenshots = [];

  // Main viewport
  const mainScreenshot = join(SCRAPED_DIR, 'screenshots', `${site.name}.png`);
  await page.screenshot({ path: mainScreenshot, type: 'png', fullPage: false });
  screenshots.push({ path: mainScreenshot, scrollY: 0, label: 'viewport' });

  // Scrolled views
  if (site.scrolls) {
    for (const scrollY of site.scrolls) {
      await page.evaluate(y => window.scrollTo(0, y), scrollY);
      await new Promise(r => setTimeout(r, 800));
      const scrollPath = join(SCRAPED_DIR, 'screenshots', `${site.name}-scroll-${scrollY}.png`);
      await page.screenshot({ path: scrollPath, type: 'png', fullPage: false });
      screenshots.push({ path: scrollPath, scrollY, label: `scroll-${scrollY}` });
    }
  }

  // ── Compute code features ──
  let codeFeatures = null;
  try {
    // Combine HTML + CSS for feature extraction
    const codeForEncoder = html.slice(0, 50000) + '\n\n/* === CSS === */\n\n' + allCss.slice(0, 50000);
    const features = encodeFromCode(codeForEncoder, {
      platform: 'web',
      targetEmotion: site.tier === 'exceptional' ? 0.9 : site.tier === 'excellent' ? 0.75 : 0.6,
    });
    codeFeatures = Array.from(features);
  } catch (e) {
    console.log(`    [warn] encoder failed: ${e.message.slice(0, 40)}`);
  }

  await page.close();

  // ── Build sample entries ──
  const samples = [];
  for (const ss of screenshots) {
    const scores = generateScores(site.tier);
    samples.push({
      image: ss.path,
      screenshot_path: ss.path,
      scores,
      source: 'scraped_real_world',
      code_features: codeFeatures,
      metadata: {
        source_name: `${site.name}${ss.label !== 'viewport' ? `-${ss.label}` : ''}`,
        source_url: site.url,
        quality_target: site.tier,
        category: site.category,
        html_path: htmlPath,
        css_path: cssPath,
        scroll_y: ss.scrollY,
        js_frameworks: jsSignals.frameworks,
        has_animations: jsSignals.hasAnimations,
        has_transitions: jsSignals.hasTransitions,
        computed_styles: cssData.computedStyles,
        scraped_at: new Date().toISOString(),
        viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
      },
    });
  }

  const screenshotCount = screenshots.length;
  const cssSize = (allCss.length / 1024).toFixed(0);
  const htmlSize = (html.length / 1024).toFixed(0);
  console.log(`  [OK] ${site.name} (${site.tier}) | ${screenshotCount} shots | HTML ${htmlSize}KB CSS ${cssSize}KB | ${jsSignals.frameworks.join(', ') || 'vanilla'}`);

  return samples;
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  const filterSite = process.argv.find((a, i) => process.argv[i - 1] === '--site');
  const listOnly = process.argv.includes('--list');

  if (listOnly) {
    console.log(`\n${SITES.length} sites configured:\n`);
    for (const s of SITES) {
      const scrollCount = (s.scrolls || []).length;
      const totalShots = 1 + scrollCount;
      console.log(`  ${s.name.padEnd(25)} ${s.tier.padEnd(12)} ${s.category.padEnd(18)} ${totalShots} screenshots`);
    }
    const totalScreenshots = SITES.reduce((sum, s) => sum + 1 + (s.scrolls || []).length, 0);
    console.log(`\nTotal: ${totalScreenshots} screenshots from ${SITES.length} sites`);
    return;
  }

  const sites = filterSite
    ? SITES.filter(s => s.name.includes(filterSite))
    : SITES;

  const totalScreenshots = sites.reduce((sum, s) => sum + 1 + (s.scrolls || []).length, 0);
  console.log(`\nScraping ${sites.length} sites (~${totalScreenshots} screenshots)...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  const allSamples = [];

  for (const site of sites) {
    try {
      const samples = await scrapeSite(browser, site);
      if (samples) allSamples.push(...samples);
    } catch (e) {
      console.log(`  [FAIL] ${site.name}: ${e.message.slice(0, 60)}`);
    }
  }

  await browser.close();

  // Update manifest
  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    : { samples: [] };

  // Remove old scraped entries (replace with fresh data)
  manifest.samples = manifest.samples.filter(s => s.source !== 'scraped_real_world');
  manifest.samples.push(...allSamples);

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Scraped: ${allSamples.length} samples from ${sites.length} sites`);
  console.log(`Total manifest: ${manifest.samples.length} samples`);
  console.log(`Saved to: ${MANIFEST_PATH}`);

  // Summary by tier
  const byTier = {};
  for (const s of allSamples) {
    const tier = s.metadata?.quality_target || 'unknown';
    byTier[tier] = (byTier[tier] || 0) + 1;
  }
  console.log(`By tier: ${Object.entries(byTier).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
