Story FS Server Specification

This specification complements Algorithm.md and defines how the HTTP server maps requests to lazily generated filesystem
resources.

The server code is in directory [storyserver](../storyserver), done with Node.js version 12 without any external
dependencies and will be run on a small Linux box. For testing it can be run within a test setup in
[testserver/](../testserver).

⸻

1. Filesystem layout

Base directory: stories/.

Each story: stories/<slug>/

Required files and directories:
• stories/<slug>/config.json
• Input configuration for the story.
• Contains at least:
• title (string)
• language (code, e.g. "en")
• storyIdea (string)
•    (Optional) model / temperature settings
• Lazily created, never regenerated:
• stories/<slug>/outline.json
• stories/<slug>/chapters/NNN.md (chapter N, zero-padded)
• stories/<slug>/audio/NNN.mp3
• stories/<slug>/feed.rss
• Optional lock files (see §5):
• outline.lock
• chapters/NNN.lock
• audio/NNN.lock
• feed.lock

<slug> is a short, URL-safe identifier, derived from the title when the story is created and kept stable.

⸻

2. HTTP API

All endpoints are under /stories/<slug>/….

2.1 Outline
• GET /stories/<slug>/outline.json

Responses:
• 200 OK + JSON body: outline.json content.
• 202 Accepted + JSON body:

{ "status": "generating", "resource": "outline" }

Outline generation is in progress; client should retry.

	•	404 Not Found if <slug> or config.json is missing.

2.2 Chapter text (Markdown)
• GET /stories/<slug>/chapters/<n>.md

<n> is 1-based, non-padded; server maps to chapters/NNN.md.

Responses:
• 200 OK + text/markdown body: content of chapters/NNN.md.
• 202 Accepted + JSON body:

{ "status": "generating", "resource": "chapter", "chapter": <n> }

Some required chapters are being generated; client should retry.

	•	404 Not Found if <slug> or requested chapter index is outside the outline.

2.3 Chapter audio
• GET /stories/<slug>/chapters/<n>.mp3

Responses:
• 200 OK + audio/mpeg body: audio/NNN.mp3.
• 202 Accepted + JSON body:

{ "status": "generating", "resource": "audio", "chapter": <n> }

	•	404 Not Found if <slug> or chapter index invalid.

2.4 RSS feed
• GET /stories/<slug>/feed.rss

Responses:
• 200 OK + application/rss+xml body.
• 202 Accepted + JSON body:

{ "status": "generating", "resource": "feed" }

	•	404 Not Found if <slug> or config.json missing.

⸻

3. Lazy generation rules

All generation uses the prompts and sequencing defined in Algorithm.md. ￼
Once a derived file exists, it is never overwritten.

3.1 Outline (outline.json)

On any request requiring the outline:

1. If outline.json exists: use it.
2. Else, attempt to create outline.lock (exclusive).
   • If lock creation fails and outline.json does not yet exist: return 202 Accepted (generation in progress).
   • If lock acquired:
   • Read config.json; if missing → 404.
   • Run outline-generation phase.
   • Write outline.tmp, then rename to outline.json.
   • Remove outline.lock.
   • Return 200 with outline.json.

3.2 Chapters (chapters/NNN.md)

On GET /chapters/<n>.md:

1. Ensure outline exists per 3.1; if outline is being generated, return 202.
2. Load outline.json and check that chapter <n> exists; else 404.
3. For each i from 1 to <n>:
   • If chapters/NNN.md exists: skip.
   • Else:
   • Try to create chapters/NNN.lock.
   • If lock exists: return 202 for the whole request.
   • If acquired:
   • Build chapter-generation context (book metadata + previous chapters, as defined in the algorithm). ￼
   • Call the model to generate chapter i.
   • Write chapters/NNN.tmp, then rename to chapters/NNN.md.
   • Remove chapters/NNN.lock.
4. Return 200 with chapters/NNN.md.

Thus, requesting chapter n may generate chapters 1..n.

3.3 Audio (audio/NNN.mp3)

On GET /chapters/<n>.mp3:

1. Ensure chapters/NNN.md exists via 3.2; if chapters are in progress, return 202.
2. If audio/NNN.mp3 exists: return 200.
3. Else:
   • Try to create audio/NNN.lock.
   • If lock exists: return 202.
   • If acquired:
   • Read chapters/NNN.md.
   • Run TTS to produce MP3.
   • Write audio/NNN.tmp, then rename to audio/NNN.mp3.
   • Remove audio/NNN.lock.
4. Return 200 with audio/NNN.mp3.

3.4 RSS (feed.rss)

On GET /feed.rss:

1. Ensure outline exists via 3.1; if in progress, return 202.
2. If feed.rss exists: return 200.
3. Else:
   • Try to create feed.lock.
   • If lock exists: return 202.
   • If acquired:
   • Read outline.json.
   • Build RSS:
   • Channel title/description from book metadata.
   •    <item> per chapter, with:
   • Title = chapter title.
   • Description = short or detailed description.
   • Link(s) to /stories/<slug>/chapters/<n>.mp3 or <n>.md.
   • Write feed.tmp, then rename to feed.rss.
   • Remove feed.lock.
4. Return 200 with feed.rss.

⸻

4. Immutability
   • config.json is considered the canonical input.
   • Derived files (outline.json, chapter .md, .mp3, feed.rss) are immutable:
   • The server never overwrites or deletes them.
   • If config.json is changed after any derived file exists, the behavior is implementation-defined but recommended:
   • Option A: ignore changes (read config.json only once and keep a snapshot).
   • Option B: detect mismatch and fail requests with 409 Conflict.

New story variants should be created under new slugs.

⸻

5. Locking and 202 semantics
   • Lock files are simple presence-based mutexes, created with exclusive open/creation.
   • While a lock exists and the final artifact does not:
   • Requests return 202 Accepted with a small JSON status message.
   • No internal blocking; the client is responsible for retrying.
   • No cache headers are required for 202 responses; they are not meant to be cached as final content.

⸻

Short summary
• Each story lives under stories/<slug>/ and is defined by config.json.
• Outline, chapters (.md), audio (.mp3), and RSS are lazily materialized, never regenerated.
• HTTP endpoints return 200 with content when ready, 202 with a JSON “generating” status while a lock is held, and
404/409 for missing or invalid resources.