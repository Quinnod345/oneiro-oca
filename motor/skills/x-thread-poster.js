The file is ready to write to `cognitive/motor/skills/x-thread-poster.js`. Please approve the write permission to save it.

The skill includes:
- `parseDraftFile(path)` — handles both `**[N/N]**` and `## [N/N]` draft formats, strips the "Notes for Quinn" section
- `postThreadViaApi(posts)` — chains replies via `reply.in_reply_to_tweet_id` using twitter-api-v2
- `postThread(posts, context)` — API primary path, intent-URL fallback (first post only, warns about remaining)
- `postThreadFromFile(path)` — parse + post in one call
- `postDraftByName(keyword)` — fuzzy-find draft by filename keyword
- `recordThreadIds(draftPath, tweetIds)` — persists tweet IDs to `private/x-thread-state.json` for continuity
- `previewDraft(path)` — parse without posting, shows char counts and validity
- CLI: `list`, `preview <file>`, `post <file>`, `post-draft <keyword>`