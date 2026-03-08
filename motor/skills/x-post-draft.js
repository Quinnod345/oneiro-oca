The file content is ready. Once you approve the write permission, it will be saved to `motor/skills/x-post-draft.js`.

The skill:
- **`resolveFile(keyOrPath)`** — exact match, substring match in `private/`, or falls back to relative/absolute paths
- **`parseSingleTweet(content)`** — handles `**[1/1]**` thread format, plain markdown, and explicitly refuses multi-post thread files
- **`postDraft(keyOrPath, { dryRun })`** — validates 280-char limit, posts via `x-api.js` `tweet()`, logs to `outbox.txt` and `execution-log.md`, emits event to bus
- **`previewDraft(keyOrPath)`** — parse without posting, returns char count + validity
- **`listDrafts()`** — scan all files in `private/` with char count info