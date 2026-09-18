// One local generation at a time. Explicit deliberation outranks background narration.
// Waiting requests can be cancelled without ever occupying the model.
export class LocalInferenceQueue {
  constructor() { this.pending = []; this.running = false; this.sequence = 0; }
  run(task, { signal, priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason || new Error('cancelled')); return; }
      const entry = { task, signal, priority, sequence: this.sequence++, resolve, reject };
      entry.abort = () => {
        const index = this.pending.indexOf(entry);
        if (index !== -1) { this.pending.splice(index, 1); reject(signal.reason || new Error('cancelled')); }
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.pending.push(entry);
      this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      this.drain();
    });
  }
  async drain() {
    if (this.running) return;
    const next = this.pending.shift();
    if (!next) return;
    this.running = true;
    next.signal?.removeEventListener('abort', next.abort);
    try {
      if (next.signal?.aborted) throw next.signal.reason || new Error('cancelled');
      next.resolve(await next.task());
    } catch (e) { next.reject(e); }
    finally { this.running = false; void this.drain(); }
  }
}
