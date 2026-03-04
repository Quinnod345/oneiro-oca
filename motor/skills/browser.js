// OCA Motor Skill: Browser
// Navigate, search, read, interact with web content
import motor from '../engine.js';
import { pool } from '../../event-bus.js';

// Open a URL in the default browser
export async function open(url) {
  return await motor.openUrl(url);
}

// Search the web
export async function search(query) {
  const encoded = encodeURIComponent(query);
  return await motor.openUrl(`https://www.google.com/search?q=${encoded}`);
}

// Open a new tab (cmd+t then navigate)
export async function newTab(url = null) {
  await motor.press('t', ['cmd']);
  if (url) {
    await sleep(500);
    await motor.press('l', ['cmd']); // focus address bar
    await sleep(200);
    await motor.type(url, { speed: 'instant' });
    await motor.press('return');
  }
}

// Close current tab
export async function closeTab() {
  await motor.press('w', ['cmd']);
}

// Switch to next/previous tab
export async function nextTab() {
  await motor.press('tab', ['ctrl']);
}

export async function prevTab() {
  await motor.press('tab', ['ctrl', 'shift']);
}

// Go back/forward
export async function goBack() {
  await motor.press('left', ['cmd']);
}

export async function goForward() {
  await motor.press('right', ['cmd']);
}

// Reload
export async function reload() {
  await motor.press('r', ['cmd']);
}

// Find on page
export async function findOnPage(text) {
  await motor.press('f', ['cmd']);
  await sleep(300);
  await motor.type(text, { speed: 'instant' });
}

// Copy page URL
export async function copyUrl() {
  await motor.press('l', ['cmd']); // focus address bar
  await sleep(200);
  await motor.press('c', ['cmd']); // copy
  await sleep(100);
  return motor.getClipboard();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { open, search, newTab, closeTab, nextTab, prevTab, goBack, goForward, reload, findOnPage, copyUrl };
