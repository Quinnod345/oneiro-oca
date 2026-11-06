import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname } from 'path';

function isPidAlive(pid) {
  const numeric = Number(pid);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function acquireProcessLock(lockPath, metadata = {}) {
  // A fresh clone has no private/ folder yet, and that's where the lock lives by default.
  mkdirSync(dirname(lockPath), { recursive: true });
  const payload = {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    ...metadata
  };

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, JSON.stringify(payload, null, 2));
      closeSync(fd);
      return { acquired: true, ownerPid: process.pid };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = readLock(lockPath);
      const ownerPid = Number(current?.pid);
      if (isPidAlive(ownerPid)) {
        return { acquired: false, ownerPid };
      }
      try { unlinkSync(lockPath); } catch {}
      if (existsSync(lockPath)) {
        return { acquired: false, ownerPid: ownerPid || null };
      }
    }
  }
}

export function releaseProcessLock(lockPath) {
  const current = readLock(lockPath);
  if (Number(current?.pid) !== process.pid) return;
  try { unlinkSync(lockPath); } catch {}
}
