Story FS Server Specification

This specification complements the [Algorithm](Algorithm.md) and defines a HTTP server that creates stories
in the specified way from a basic story configuration describing the story idea.
The server maps requests to lazily generated filesystem
resources so that the story parts are generated on demand.

The server code is in directory [storyserver](../storyserver), done with Node.js version 12 without any external
dependencies and will be run on a small Linux box. For testing it can be run within a test setup in
[testserver/](../testserver). Files there:

- server.js is the actual HTTP server.
- mapper.js implements the lazy generation logic per this specification, defining the mapping of paths to files and
  calling the appropriate generation functions from storygen.js.
- storygen.js implements the actual story generation logic per Algorithm.md.
- openai.js implements the OpenAI API calls.

The OpenAI API key is provided via the environment variable OPENAI_API_KEY. There is a server.conf in the directory
the server is started in that defines port and the OpenAI models to use.

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
• stories/<slug>/audio/<slug>.m3u (playlist with relative links to all mp3 files)
• stories/<slug>/audio/<slug>.zip (zip with all mp3s, generated via external zip)
• stories/<slug>/feed.rss
• stories/<slug>/cover.jpg (generated cover art from story idea)

<slug> is a short, URL-safe identifier, derived from the title when the story is created and kept stable.

⸻

2. HTTP API

All endpoints are under /stories/<slug>/….

2.0 Global story index
• GET /storyindex.html (or /storyindex)
    • 200 OK + text/html: lists all stories discovered under stories/<slug>/ that contain a config.json, showing title, language, story idea, and whether the outline exists. Links into each /stories/<slug>/index.html.

2.0 Story landing page
• GET /stories/<slug>/ (or /stories/<slug>/index.html)
    • 200 OK + text/html: Generated summary page rendered with Bootstrap (via CDN) in a light pastel style.
    • Shows config.json data, outline (if present), character list, and links to outline.json, feed.rss, and every chapter’s Markdown/HTML/audio paths (even if not yet generated).
    • Includes a “Generate outline” button that calls /stories/<slug>/outline.json; while 202 is returned it polls, and reloads the page when the outline is ready.

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

2.5 Chapter HTML view
• GET /stories/<slug>/chapters/<n>.html

Responses:
• 200 OK + text/html body: page that fetches and renders the Markdown via a CDN markdown renderer (e.g., marked), styled with Bootstrap.
• 202 Accepted is never returned directly; polling happens client-side when the backing .md returns 202.
• Page shows navigation links to previous/next chapter when known (from outline.json) and back to /stories/<slug>/index.html.

2.6 Audio playlist
• GET /stories/<slug>/audio/<slug>.m3u

Responses:
• 200 OK + audio/x-mpegurl: M3U playlist with relative entries for every chapter mp3 (e.g., 001.mp3). Includes #EXTM3U and #EXTINF lines with chapter titles when available.
• 202 Accepted if outline generation is in progress.
• 404 Not Found if <slug> or config.json missing.

2.7 Audio archive
• GET /stories/<slug>/audio/<slug>.zip

Responses:
• 200 OK + application/zip: zip containing all chapter mp3 files (names as 001.mp3, 002.mp3, …).
• 202 Accepted if outline generation or audio generation is in progress.
• 404 Not Found if <slug> or config.json missing.

2.8 Cover image
• GET /stories/<slug>/cover.jpg

Responses:
• 200 OK + image/jpeg: generated cover art based on the story idea (model gpt-image-1).
• 202 Accepted if generation is in progress.
• 404 Not Found if <slug> or config.json missing.

⸻

3. Lazy generation rules

All generation uses the prompts and sequencing defined in Algorithm.md. ￼
Once a derived file exists, it is never overwritten.

3.1 Outline (outline.json)

On any request requiring the outline:

1. If outline.json exists: use it.
2. Else, attempt to acquire an in-memory lock for this outline.
   • If lock already held and outline.json does not yet exist: return 202 Accepted (generation in progress).
   • If lock acquired:
       • Read config.json; if missing → 404.
       • Run outline-generation phase.
       • Write outline.tmp, then rename to outline.json.
       • Release the in-memory lock.
       • Return 200 with outline.json.

3.2 Chapters (chapters/NNN.md)

On GET /chapters/<n>.md:

1. Ensure outline exists per 3.1; if outline is being generated, return 202.
2. Load outline.json and check that chapter <n> exists; else 404.
3. For each i from 1 to <n>:
   • If chapters/NNN.md exists: skip.
   • Else:
       • Try to acquire an in-memory generation lock for that chapter.
       • If lock held: return 202 for the whole request.
       • If acquired:
           • Build chapter-generation context (book metadata + previous chapters, as defined in the algorithm).
           • Call the model to generate chapter i.
           • Write chapters/NNN.tmp, then rename to chapters/NNN.md.
           • Release the in-memory lock.
4. Return 200 with chapters/NNN.md.
5. Optimization: after chapter n is ready and served, the server may start generating chapter n+1 in the background.

Thus, requesting chapter n may generate chapters 1..n.

3.3 Audio (audio/NNN.mp3)

On GET /chapters/<n>.mp3:

1. Ensure chapters/NNN.md exists via 3.2; if chapters are in progress, return 202.
2. If audio/NNN.mp3 exists: return 200.
3. Else:
   • Try to acquire an in-memory generation lock for that audio file.
   • If lock exists: return 202.
   • If acquired:
       • Read chapters/NNN.md.
       • Chunk text for TTS to <=4000 characters per request, preferring paragraph boundaries (falling back to sentences).
       • Run TTS to produce MP3 for each chunk and concatenate.
       • Add ID3 metadata (title, album/book title, author when available) and embed cover art if present.
       • Write audio/NNN.tmp, then rename to audio/NNN.mp3.
       • Release the in-memory lock.
4. Return 200 with audio/NNN.mp3.
5. Optimization: after serving audio for chapter n, the server may start generating audio for chapter n+1 in the background (after ensuring chapter n+1 exists).

Zip archive
• When /stories/<slug>/audio/<slug>.zip is requested, the server ensures outline, all chapters, and all mp3 files exist, then runs the system “zip” command to package the mp3s (no regeneration if the zip already exists).

Cover art
• Generated once per story (cover.jpg) using model gpt-image-1 and the story idea as prompt; reused in the story index, MP3 metadata, and available via /stories/<slug>/cover.jpg.

3.4 RSS (feed.rss)

On GET /feed.rss:

1. Ensure outline exists via 3.1; if in progress, return 202.
2. If feed.rss exists: return 200.
3. Else:
   • Try to acquire an in-memory generation lock for the feed.
   • If lock exists: return 202.
   • If acquired:
       • Read outline.json.
       • Build RSS:
           • Channel title/description from book metadata.
           • <item> per chapter, with:
             • Title = chapter title.
             • Description = short or detailed description.
             • Link(s) to /stories/<slug>/chapters/<n>.mp3 or <n>.md.
       • Write feed.tmp, then rename to feed.rss.
       • Release the in-memory lock.
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
   • Locking is in-memory only (a per-process map). No *.lock files are written to disk.
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

⸻

Further ideas to be done:

- fix mp3 generation: the prompt can only be up to 4000 characters. Split on paragraph boundaries to not cut sentences.
- serve a zip of all mp3 files for easy download of the whole story using the external zip program. Before that generate
  all mp3 files if not yet done.
- generate cover art based on story idea using gpt-image-1 and include as cover.jpg and display it on the story index page.
- Add MP3 metadata tags (ID3) with chapter title, book title, author, and cover art (if available) with id3v2.
- Later perhaps: UI to create story config files
