# Instruction for coding agents

- Always read Requirements.md first before starting to code to get an understanding what this is about. This file is
  most important and authoritative for the requirements.
- Do not run the server yourself, also not for testing. Let the user run it at the end. Do not try to test yourself
  except if explicitly told to do so.
- Do not generate a summary file afterwards.

## Quick start & app overview (for coding agents)

This project is a client-side single-page application (SPA) that uses the browser to call the OpenAI Chat Completions
API and the Web Speech (SpeechSynthesis) API for text-to-speech.

Keep these quick facts in mind so you can start working without reading the whole codebase first:

- Main files:
    - `docs/index.html` — main UI and IDs used by the script.
    - `docs/app.js` — UI interface logic (TTS, voice/language handling, localStorage usage).
    - `docs/createstory.js` - business logic (outline generation, chapter generation, OpenAI calls)
    - `docs/style.css` — styling.
    - `dev-server.js` — simple dev server (port 3001 by default).
    - `prompts/outline.md` and `prompts/chapter.md` — default system prompts that `app.js` loads on startup.
- Text-to-speech:
    - Uses the browser `window.speechSynthesis` voices. `app.js` populates `#voice-select` and `#language-select` (
      filters voices by language prefix like `en`, `de`).
- Quick checklist for first edits / investigation:
    1. Open `Requirements.md` (already required) to understand intended UX and constraints.
    2. Inspect `docs/app.js` for the exact logic you want to change (look for functions named `callOpenAI`,
       `generateChapter`, `populateVoicesAndLanguages`, `speakChapter`).
    3. Verify UI element IDs in `docs/index.html` match the selectors in `app.js`.
    4. Check `prompts/outline.md` and `prompts/chapter.md` for default system prompt text.
