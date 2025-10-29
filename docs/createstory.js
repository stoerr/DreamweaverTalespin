// Business logic and AI access for story generation
// This module contains no DOM manipulation - only pure functions that work with strings and data structures

/**
 * Call OpenAI Chat Completions API
 * @param {string} apiKey - OpenAI API key
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} opts - Optional parameters (model, temperature, max_tokens)
 * @returns {Promise<string>} - Response text from OpenAI
 */
async function callOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || 'gpt-4o',
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: typeof opts.max_tokens === 'number' ? opts.max_tokens : 1024,
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let msg = `Error ${resp.status}`;
    try {
      const json = JSON.parse(text);
      msg = json.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Invalid response from OpenAI');

  return content;
}

/**
 * Parse outline text into structured data
 * @param {string} text - Raw outline text from AI
 * @returns {Array<{title: string, description: string, chapterText: null}>} - Parsed outline entries
 */
function parseOutline(text) {
  // Expect lines like "1. Title - description" or "1) Title - description"
  const lines = (text || '').split('\n').map(l => l.trim()).filter(l => l);
  const entries = [];
  for (const line of lines) {
    // Remove leading numbering like "1." or "1)"
    const m = line.match(/^\s*(\d+)\s*[.)]?\s*(.*)$/);
    let rest = line;
    if (m) rest = m[2];
    // Split title and description by ' - ' or ' — ' or ':'
    let title = rest;
    let description = '';
    const sepMatch = rest.match(/^(.*?)\s*[-—:|]\s*(.*)$/);
    if (sepMatch) {
      title = sepMatch[1].trim();
      description = sepMatch[2].trim();
    }
    entries.push({ title, description, chapterText: null });
  }
  return entries;
}

/**
 * Get language instruction for AI based on language code
 * @param {string|null} languageCode - Language code (e.g., 'en', 'de', 'fr', 'es')
 * @returns {string|null} - Language instruction text or null
 */
function getLanguageInstruction(languageCode) {
  if (!languageCode) return null;
  // crude mapping for display name
  const map = { en: 'English', de: 'German', fr: 'French', es: 'Spanish' };
  const name = map[languageCode] || languageCode;
  return `Respond in ${name} (${languageCode}).`;
}

/**
 * Generate story outline using AI
 * @param {string} apiKey - OpenAI API key
 * @param {string} storyPrompt - User's story idea
 * @param {string} systemPrompt - System prompt for outline generation
 * @param {string|null} languageCode - Optional language code
 * @returns {Promise<Array<{title: string, description: string, chapterText: null}>>} - Generated outline
 */
async function generateOutline(apiKey, storyPrompt, systemPrompt, languageCode = null) {
  const messages = [];
  const langInstr = getLanguageInstruction(languageCode);
  if (langInstr) messages.push({ role: 'system', content: langInstr });
  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: storyPrompt });

  const text = await callOpenAI(apiKey, messages);
  return parseOutline(text);
}

/**
 * Generate a single chapter using AI
 * @param {string} apiKey - OpenAI API key
 * @param {Object} chapterInfo - Chapter information {title: string, description: string}
 * @param {string} systemPrompt - System prompt for chapter generation
 * @param {Array<{title: string, description: string, chapterText: string|null}>} priorChapters - Previous chapters for context
 * @param {string|null} languageCode - Optional language code
 * @returns {Promise<string>} - Generated chapter text
 */
async function generateChapter(apiKey, chapterInfo, systemPrompt, priorChapters = [], languageCode = null) {
  const messages = [];
  const langInstr = getLanguageInstruction(languageCode);
  if (langInstr) messages.push({ role: 'system', content: langInstr });
  messages.push({ role: 'system', content: systemPrompt });

  // Add prior chapters as context
  for (const prev of priorChapters) {
    if (!prev) continue;
    const prevUser = `Chapter: ${prev.title}\nDescription: ${prev.description}`;
    messages.push({ role: 'user', content: prevUser });
    if (prev.chapterText) {
      messages.push({ role: 'assistant', content: prev.chapterText });
    }
  }

  // Request the current chapter
  const userContent = `Chapter: ${chapterInfo.title}\nDescription: ${chapterInfo.description}`;
  messages.push({ role: 'user', content: userContent });

  const response = await callOpenAI(apiKey, messages);
  return (response || '').trim();
}

// Export functions for use in app.js
window.StoryGenerator = {
  callOpenAI,
  parseOutline,
  getLanguageInstruction,
  generateOutline,
  generateChapter,
};
