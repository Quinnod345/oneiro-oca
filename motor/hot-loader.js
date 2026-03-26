import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { emit } from '../event-bus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname);

const moduleCache = new Map();

async function loadSkillFile(filePath, engineRef) {
  const absolutePath = path.resolve(filePath);
  const skillName = path.basename(absolutePath, '.js');

  if (skillName === 'hot-loader' || skillName === 'index') return null;

  try {
    const fileUrl = pathToFileURL(absolutePath).href + '?t=' + Date.now();
    const mod = await import(fileUrl);
    const skill = mod.default ?? mod;

    if (!skill || typeof skill !== 'object') {
      console.error(`[hot-loader] ${skillName}: no valid default export`);
      return null;
    }

    const prev = moduleCache.get(skillName);
    const isUpdate = !!prev;
    moduleCache.set(skillName, { path: absolutePath, skill, loadedAt: Date.now() });

    if (engineRef && engineRef.skills && typeof engineRef.skills === 'object') {
      engineRef.skills[skillName] = skill;
    }

    if (engineRef && typeof engineRef.registerSkill === 'function') {
      engineRef.registerSkill(skillName, skill);
    }

    await emit('skill:loaded', {
      name: skillName,
      path: absolutePath,
      updated: isUpdate,
      timestamp: Date.now()
    }).catch(() => {});

    console.log(`[hot-loader] ${isUpdate ? 'reloaded' : 'loaded'}: ${skillName}`);
    return skill;
  } catch (err) {
    console.error(`[hot-loader] failed to load ${skillName}:`, err.message);
    await emit('skill:load-error', {
      name: skillName,
      path: absolutePath,
      error: err.message,
      timestamp: Date.now()
    }).catch(() => {});
    return null;
  }
}

async function loadAllSkills(engineRef) {
  let files;
  try {
    files = fs.readdirSync(SKILLS_DIR);
  } catch (err) {
    console.error('[hot-loader] cannot read skills dir:', err.message);
    return;
  }

  const jsFiles = files.filter(f => f.endsWith('.js') && f !== 'hot-loader.js' && f !== 'index.js');
  for (const file of jsFiles) {
    await loadSkillFile(path.join(SKILLS_DIR, file), engineRef);
  }
}

function startWatching(engineRef) {
  loadAllSkills(engineRef).catch(err => {
    console.error('[hot-loader] initial load error:', err.message);
  });

  const debounceMap = new Map();

  const watcher = fs.watch(SKILLS_DIR, { persistent: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    if (filename === 'hot-loader.js' || filename === 'index.js') return;

    const filePath = path.join(SKILLS_DIR, filename);

    if (debounceMap.has(filename)) {
      clearTimeout(debounceMap.get(filename));
    }

    const timer = setTimeout(async () => {
      debounceMap.delete(filename);

      let exists = false;
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
        exists = true;
      } catch (_) {}

      if (!exists) {
        const skillName = path.basename(filename, '.js');
        if (moduleCache.has(skillName)) {
          moduleCache.delete(skillName);
          if (engineRef && engineRef.skills) {
            delete engineRef.skills[skillName];
          }
          if (engineRef && typeof engineRef.unregisterSkill === 'function') {
            engineRef.unregisterSkill(skillName);
          }
          await emit('skill:unloaded', { name: skillName, timestamp: Date.now() }).catch(() => {});
          console.log(`[hot-loader] unloaded: ${skillName}`);
        }
        return;
      }

      await loadSkillFile(filePath, engineRef);
    }, 150);

    debounceMap.set(filename, timer);
  });

  watcher.on('error', err => {
    console.error('[hot-loader] watcher error:', err.message);
  });

  console.log(`[hot-loader] watching ${SKILLS_DIR}`);
  return watcher;
}

export { startWatching, loadSkillFile };

export default { startWatching, loadSkillFile };