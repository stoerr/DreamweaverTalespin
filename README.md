# storyteller
Experiment to use AI to tell stories

## Description
A single-page client-side application that uses OpenAI's Chat Completions API to generate story outlines and chapters and uses the browser's Web Speech API to read chapters aloud.

This repository is intentionally serverless for the application itself — the small Node.js script included is only a static file development server that serves the files from the `docs/` folder with no-cache headers so you can iterate quickly in the browser.

## Features
- Clean, modern user interface (Bootstrap) served from `docs/`
- Generate an outline from a short story idea, then expand each outline item into a full chapter
- Play chapters using the browser `SpeechSynthesis` voices; the UI highlights chapters while they are being read
- Autoplay next chapter while the following one is generated in the background (can be toggled)
- Language selector influences both generation instructions and the voice selection
- Last story prompt and last selected voice are persisted in `localStorage`
- OpenAI API key is stored in `localStorage` (key name `chatgpt_api_key`) and used directly from the browser

## Files
- `docs/index.html` - Main HTML UI
- `docs/style.css` - Styling
- `docs/app.js` - Main JavaScript (outline + chapter generation, TTS, voice/language handling, localStorage, OpenAI calls)
- `dev-server.js` - Development server with no-cache headers
- `prompts/outline.md` and `prompts/chapter.md` - Default system prompts that `docs/app.js` will load on startup

## Development Server
### Prerequisites
- Node.js (any recent version)

### Run the server
Start the dev server from the project root:

```bash
npm start
# or
node dev-server.js
```

Open your browser at:

```
http://localhost:3001/
```

The server serves files from the `docs/` directory and sets HTTP headers to prevent browser caching so changes are visible immediately.

## Usage
1. Open the app in your browser.
2. When prompted, enter your OpenAI API key. The key is stored locally in `localStorage` under the key `chatgpt_api_key` and is only used by the browser to call OpenAI's API.
3. Enter a short story idea (or pick one from the Examples dropdown).
4. Click "Generate Outline" to create a chapter outline.
5. Select a chapter and click "Generate Selected Chapter" to expand it into full text.
6. Use the Play / Pause / Stop buttons to listen to chapters. Autoplay (enabled by default) will advance and read the next chapter while the following chapter is generated in the background.

## Notes and Limitations
- There is no server-side component for the story generation — requests to OpenAI are made directly from the browser using the API key you provide.
- The development server included here is for convenience only and should not be used as a production server.
- The UI does not expose the API key in the page; it is requested via a prompt and stored in `localStorage`.

## Troubleshooting
- If the editor prompts for a file that doesn't exist (e.g. `server.js`), note that the correct development server file is `dev-server.js` in the repository root.
- If voices don't appear in the voice selector immediately, try reloading the page or wait for `speechSynthesis.onvoiceschanged` to populate the list (this is browser-dependent).

## License
MIT
