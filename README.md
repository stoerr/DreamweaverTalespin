# storyteller
Experiment to use AI to tell stories

## Description
A single-page application that uses OpenAI's API to generate creative stories based on user prompts. Simply enter your API key, provide a story idea, and let AI craft an engaging narrative for you.

## Features
- Clean, modern user interface
- Adjustable story length (short, medium, long)
- Secure API key storage (stored locally, never sent to external servers)
- Real-time story generation using OpenAI's GPT models

## Development Server

This repository includes a simple Node.js development server that serves the application files without caching, making it easy to test changes during development.

### Prerequisites
- Node.js (any recent version)

### Running the Development Server

1. Start the server:
   ```bash
   npm start
   ```
   or
   ```bash
   node server.js
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

3. The server will serve files with no-cache headers to ensure you always see the latest changes.

### Usage

1. Enter your OpenAI API key (get one from https://platform.openai.com/api-keys)
2. Enter a story prompt (e.g., "A brave knight on a quest to save a dragon from a princess")
3. Select your desired story length
4. Click "Generate Story" and watch as AI crafts your tale

## Files
- `index.html` - Main HTML structure
- `style.css` - Styling and layout
- `app.js` - JavaScript for OpenAI integration
- `server.js` - Development server with no-cache headers

## Note
Your API key is stored only in your browser's local storage and is never sent to any server other than OpenAI's API directly from your browser.
