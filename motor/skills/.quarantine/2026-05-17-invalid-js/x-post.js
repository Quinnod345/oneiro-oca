The Write tool is blocked because the `motor/skills/` directory doesn't exist yet. You'll need to create it first, or approve the directory creation. Here's the complete file content — you can save it after creating the directory:

```
mkdir -p motor/skills
```

Then the file at `motor/skills/x-post.js`:

```javascript
// motor/skills/x-post.js — handles x_post task type
// Reads a staged draft from private/, posts to X via x-api.js, logs result to outbox.txt

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { pool, emit } from '../../cognitive/event-bus.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '../../');
const OUTBOX = join(ROOT, 'outbox.txt');

function parseThread(content) {
  const posts = [];
  const blockPattern = /\*\*\[(\d+)\/(\d+)\]\*\*\n\n([\s\S]*?)(?=\n---\n|\n\*\*\[\d+\/\d+\]\*\*|## Notes|$)/g;
  let match;
  while ((match = blockPattern.exec(content)) !== null) {
    const [, num, total, body] = match;
    const text = body.trim().replace(/\n\n?\*~\d+ chars\*\s*$/, '').trim();
    if (text) posts.push({ num: parseInt(num), total: parseInt(total), text });
  }
  if (posts.length === 0) throw new Error('No thread posts found. Expected **[N/M]** format.');
  posts.sort((a, b) => a.num - b.num);
  return posts;
}

function parseSinglePost(content) {
  const text = content.replace(/^#.*$/gm, '').replace(/^\s*---+\s*$/gm, '').trim();
  if (!text) throw new Error('Empty post content after parsing.');
  return text;
}

function logToOutbox(message) {
  const ts = new Date().toISOString();
  try {
    appendFileSync(OUTBOX, `[${ts}] [x-post] ${message}\n`, 'utf8');
  } catch (e) {
    console.error('[x-post] outbox write error:', e.message);
  }
}

async function execute(params = {}) {
  const { file, mode = 'auto', dryRun = false } = params;

  if (!file) throw new Error('x_post requires params.file — path to staged draft');

  const filePath = file.startsWith('/') ? file : join(ROOT, file);
  if (!existsSync(filePath)) throw new Error(`Draft not found: ${filePath}`);

  const content = readFileSync(filePath, 'utf8');
  const fileName = basename(filePath);

  const isThread = mode === 'thread' || (mode === 'auto' && content.includes('**[1/'));
  const posts = isThread
    ? parseThread(content)
    : [{ num: 1, total: 1, text: parseSinglePost(content) }];

  const violations = posts.filter(p => p.text.length > 280);
  if (violations.length > 0) {
    const detail = violations.map(p => `post ${p.num}: ${p.text.length} chars`).join(', ');
    throw new Error(`Post(s) exceed 280 chars — ${detail}`);
  }

  if (dryRun) {
    const preview = posts.map(p => `  [${p.num}/${p.total}] ${p.text.length} chars`).join('\n');
    logToOutbox(`DRY RUN ${fileName} (${posts.length} post${posts.length !== 1 ? 's' : ''})\n${preview}`);
    await emit('x_post_dry_run', 'motor', { file: fileName, postCount: posts.length });
    return { ok: true, dryRun: true, postCount: posts.length, posts };
  }

  const xApiModule = await import('../../x-api.js');
  const xApi = xApiModule.default || xApiModule;

  let results;
  if (posts.length === 1) {
    const result = await xApi.tweet(posts[0].text);
    results = [result];
    logToOutbox(`POSTED ${fileName} → tweet id ${result.id}`);
  } else {
    results = await xApi.thread(posts.map(p => p.text));
    logToOutbox(`POSTED thread ${fileName} (${posts.length} posts) → ids ${results.map(r => r.id).join(', ')}`);
  }

  await emit('x_post_complete', 'motor', {
    file: fileName,
    postCount: results.length,
    tweetIds: results.map(r => r.id),
  });

  return { ok: true, dryRun: false, postCount: results.length, results };
}

async function preview(file) {
  const filePath = file.startsWith('/') ? file : join(ROOT, file);
  const content = readFileSync(filePath, 'utf8');
  const posts = content.includes('**[1/')
    ? parseThread(content)
    : [{ num: 1, total: 1, text: parseSinglePost(content) }];
  return { file: basename(filePath), postCount: posts.length, posts };
}

export default {
  taskType: 'x_post',
  execute,
  preview,
};
```

The skill:
- Resolves draft path relative to repo root if not absolute
- Auto-detects thread vs single post format
- Validates 280-char limits before posting
- Uses `x-api.js` `tweet()` or `thread()` depending on post count
- Logs all outcomes (including dry runs) to `outbox.txt`
- Emits `x_post_dry_run` / `x_post_complete` events to the cognitive event bus