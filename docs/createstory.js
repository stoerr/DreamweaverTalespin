// Business logic and AI access for story generation
// This module contains no DOM manipulation - only pure functions that work with strings and data structures

/**
 * Call OpenAI Chat Completions API
 * @param {string} apiKey - OpenAI API key
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {Object} opts - Optional parameters (model, temperature, max_tokens, response_format)
 * @returns {Promise<string>} - Response text from OpenAI
 */
async function callOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || 'gpt-4o',
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: typeof opts.max_tokens === 'number' ? opts.max_tokens : 1024,
  };

  // Add response_format if specified (for JSON mode)
  if (opts.response_format) {
    body.response_format = opts.response_format;
  }

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
 * Parse outline text (JSON or fallback to legacy format) into structured data
 * @param {string} text - Raw outline text from AI (JSON or legacy line format)
 * @returns {{title: string|null, chapters: Array<{title: string, description: string, details: string, chapterText: null}>}} - Parsed outline with title and entries
 */
function parseOutline(text) {
  // Try to parse as JSON first
  try {
    const json = JSON.parse(text);
    if (json && json.chapters && Array.isArray(json.chapters)) {
      // Structured JSON format
      const entries = json.chapters.map(ch => ({
        title: ch.chaptertitle || ch.title || 'Untitled',
        description: ch.chaptershortdescription || ch.description || '',
        details: ch.chapterdetails || '',
        chapterText: null
      }));
      return {
        title: json.title || null,
        chapters: entries
      };
    }
  } catch (e) {
    // Not JSON or invalid format, fall through to legacy parsing
  }

  // Legacy format: lines like "1. Title - description"
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
    entries.push({ title, description, details: '', chapterText: null });
  }
  return {
    title: null,
    chapters: entries
  };
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
 * Generate story outline using AI with structured JSON output
 * @param {string} apiKey - OpenAI API key
 * @param {string} storyPrompt - User's story idea
 * @param {string} systemPrompt - System prompt for outline generation
 * @param {string|null} languageCode - Optional language code
 * @returns {Promise<{title: string|null, chapters: Array<{title: string, description: string, details: string, chapterText: null}>}>} - Generated outline with title
 */
async function generateOutline(apiKey, storyPrompt, systemPrompt, languageCode = null) {
  const messages = [];
  const langInstr = getLanguageInstruction(languageCode);
  if (langInstr) messages.push({ role: 'system', content: langInstr });

  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: storyPrompt });

  // Define JSON Schema for structured output
  const responseFormat = {
    type: "json_schema",
    json_schema: {
      name: "story_outline",
      strict: true,
      schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the book"
          },
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                chaptertitle: {
                  type: "string",
                  description: "Title of the chapter"
                },
                chaptershortdescription: {
                  type: "string",
                  description: "One sentence short description of the chapter starting with where"
                },
                chapterdetails: {
                  type: "string",
                  description: "One paragraph detailed description of the chapter, including what happens and who is involved"
                }
              },
              required: ["chaptertitle", "chaptershortdescription", "chapterdetails"],
              additionalProperties: false
            }
          }
        },
        required: ["title", "chapters"],
        additionalProperties: false
      }
    }
  };

  const text = await callOpenAI(apiKey, messages, {
    response_format: responseFormat
  });

  return parseOutline(text);
}

/**
 * Generate a single chapter using AI
 * @param {string} apiKey - OpenAI API key
 * @param {Object} chapterInfo - Chapter information {title: string, description: string, details: string}
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

  // Request the current chapter with details if available
  let userContent = `Chapter: ${chapterInfo.title}\nDescription: ${chapterInfo.description}`;
  if (chapterInfo.details) {
    userContent += `\nDetails: ${chapterInfo.details}`;
  }
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
