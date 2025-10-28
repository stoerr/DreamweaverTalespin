// Store API key in localStorage for convenience
// Note: localStorage is appropriate for this client-side-only app where the API key
// is used directly from the browser to call OpenAI's API. The key never goes to our servers.
// Users should be aware that localStorage is accessible to any script on the same origin.
const API_KEY_STORAGE = 'chatgpt_api_key';

// DOM elements
const outlineSystemPromptInput = document.getElementById('outline-system-prompt');
const chapterSystemPromptInput = document.getElementById('chapter-system-prompt');
const storyPromptInput = document.getElementById('story-prompt');
const generateOutlineBtn = document.getElementById('generate-outline');
const outlineList = document.getElementById('outline-list');
const generateChapterBtn = document.getElementById('generate-chapter');
const generateNextBgBtn = document.getElementById('generate-next-bg');
const chapterContainer = document.getElementById('chapter-container');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const voiceSelect = document.getElementById('voice-select');
const languageSelect = document.getElementById('language-select');
const autoplayCheckbox = document.getElementById('autoplay');

let outline = []; // {title, description, chapterText (optional)}
let selectedIndex = null;
let isGenerating = false;
let synth = window.speechSynthesis;
let currentUtterance = null;
let playingIndex = null;

// Helpers: API key stored only in localStorage; UI input removed per request
function setApiKey(key) {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
}
function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || null;
}

// Prompt for API key if not present; load default prompts; populate voices & languages
window.addEventListener('DOMContentLoaded', async () => {
  let apiKey = getApiKey();
  if (!apiKey) {
    const entered = prompt('Please enter your OpenAI API key (will be stored in localStorage at "chatgpt_api_key"):');
    if (entered) setApiKey(entered.trim());
  }

  // Load default system prompts from files
  try {
    const [outlineTxt, chapterTxt] = await Promise.all([
      fetch('/prompts/outline.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
      fetch('/prompts/chapter.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
    ]);
    if (outlineTxt) outlineSystemPromptInput.value = outlineTxt.trim();
    if (chapterTxt) chapterSystemPromptInput.value = chapterTxt.trim();
  } catch (e) {
    console.warn('Could not load prompt files:', e);
  }

  // Populate voices and language selector
  populateVoicesAndLanguages();
  window.speechSynthesis.onvoiceschanged = populateVoicesAndLanguages;
});

function populateVoicesAndLanguages() {
  const voices = synth.getVoices();
  // Build languages set from voice.lang (prefix before '-')
  const langs = Array.from(new Set(voices.map(v => (v.lang || 'unknown').split('-')[0]))).filter(Boolean).sort();

  // Populate languageSelect if present
  if (languageSelect) {
    const prev = languageSelect.value;
    languageSelect.innerHTML = '';
    // add an 'any' option
    const anyOpt = document.createElement('option');
    anyOpt.value = '';
    anyOpt.textContent = 'Any';
    languageSelect.appendChild(anyOpt);
    langs.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      languageSelect.appendChild(opt);
    });
    if (prev) languageSelect.value = prev;
  }

  // Populate voiceSelect filtered by language
  refreshVoiceSelect();
}

function refreshVoiceSelect() {
  const voices = synth.getVoices();
  const lang = (languageSelect && languageSelect.value) || '';
  voiceSelect.innerHTML = '';
  const filtered = voices.filter(v => {
    if (!lang) return true; // any
    const p = (v.lang || '').split('-')[0];
    return p === lang;
  });
  // If no voices match the language, fall back to all voices
  const toShow = filtered.length ? filtered : voices;
  toShow.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
    voiceSelect.appendChild(opt);
  });
}

if (languageSelect) {
  languageSelect.addEventListener('change', () => {
    refreshVoiceSelect();
  });
}

function showMessageInChapterContainer(html) {
  chapterContainer.innerHTML = html;
}

function showError(msg) {
  showMessageInChapterContainer(`<div class="error">${escapeHtml(msg)}</div>`);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getLanguageInstruction() {
  if (!languageSelect) return null;
  const code = languageSelect.value;
  if (!code) return null;
  // crude mapping for display name
  const map = { en: 'English', de: 'German', fr: 'French', es: 'Spanish' };
  const name = map[code] || code;
  return `Respond in ${name} (${code}).`;
}

// Outline generation
generateOutlineBtn.addEventListener('click', async () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    const entered = prompt('OpenAI API key not found. Please enter it:');
    if (entered) setApiKey(entered.trim());
    else return;
  }

  const storyPrompt = storyPromptInput.value.trim();
  if (!storyPrompt) {
    alert('Please enter the story prompt.');
    return;
  }

  let systemPrompt = (outlineSystemPromptInput.value || '').trim();
  if (!systemPrompt) systemPrompt = 'You are an assistant that returns a numbered outline of chapters for a story. Return each chapter on its own line like "1. Chapter Title - short description".';

  generateOutlineBtn.disabled = true;
  showMessageInChapterContainer('<div class="placeholder">Generating outline…</div>');

  try {
    const langInstr = getLanguageInstruction();
    const messages = [];
    if (langInstr) messages.push({ role: 'system', content: langInstr });
    messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: storyPrompt });

    const text = await callOpenAI(apiKey, messages);

    outline = parseOutline(text);
    renderOutline();
    showMessageInChapterContainer('<div class="placeholder">Outline generated. Select a chapter to generate it.</div>');
  } catch (err) {
    console.error(err);
    showError('Failed to generate outline: ' + err.message);
  } finally {
    generateOutlineBtn.disabled = false;
  }
});

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

function renderOutline() {
  outlineList.innerHTML = '';
  if (!outline.length) {
    const div = document.createElement('div');
    div.className = 'list-group-item placeholder';
    div.textContent = 'No outline yet. Generate one to start.';
    outlineList.appendChild(div);
    return;
  }

  outline.forEach((item, idx) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'list-group-item list-group-item-action';
    el.innerHTML = `<strong>${idx + 1}. ${escapeHtml(item.title)}</strong><div class="small text-muted">${escapeHtml(item.description)}</div>`;
    el.addEventListener('click', () => selectOutlineIndex(idx));
    outlineList.appendChild(el);
  });
}

function selectOutlineIndex(idx) {
  selectedIndex = idx;
  // highlight selection
  Array.from(outlineList.children).forEach((c, i) => {
    c.classList.toggle('active', i === idx);
  });

  const item = outline[idx];
  if (item.chapterText) {
    showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div>${escapeHtml(item.chapterText).replace(/\n/g, '<br/>')}</div>`);
  } else {
    showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div class="placeholder">No chapter generated yet. Click "Generate Selected Chapter".</div><p class="small text-muted">${escapeHtml(item.description)}</p>`);
  }
}

// Chapter generation
generateChapterBtn.addEventListener('click', async () => {
  if (selectedIndex === null) {
    alert('Please select a chapter from the outline first.');
    return;
  }
  await generateChapter(selectedIndex, true);
});

generateNextBgBtn.addEventListener('click', async () => {
  if (!outline.length) {
    alert('No outline available. Generate one first.');
    return;
  }
  const next = outline.findIndex((o) => !o.chapterText);
  if (next === -1) {
    alert('All chapters already generated.');
    return;
  }
  // start background generation
  generateChapter(next, false).catch(err => console.error('Background generation failed', err));
});

async function generateChapter(idx, foreground = true) {
  if (isGenerating) return;
  isGenerating = true;
  let apiKey = getApiKey();
  if (!apiKey) {
    const entered = prompt('OpenAI API key not found. Please enter it:');
    if (entered) setApiKey(entered.trim());
    apiKey = getApiKey();
    if (!apiKey) {
      isGenerating = false;
      return;
    }
  }

  const item = outline[idx];
  if (!item) {
    isGenerating = false;
    return;
  }

  let systemPrompt = (chapterSystemPromptInput.value || '').trim();
  if (!systemPrompt) systemPrompt = 'You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.';
  const userContent = `Chapter: ${item.title}\nDescription: ${item.description}`;

  if (foreground) showMessageInChapterContainer('<div class="placeholder">Generating chapter…</div>');

  try {
    const langInstr = getLanguageInstruction();
    const messages = [];
    if (langInstr) messages.push({ role: 'system', content: langInstr });
    messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userContent });

    const resp = await callOpenAI(apiKey, messages, { temperature: 0.8, max_tokens: 1000 });

    item.chapterText = (resp || '').trim();

    if (selectedIndex === idx) selectOutlineIndex(idx);
    return resp;
  } catch (err) {
    console.error(err);
    if (foreground) showError('Failed to generate chapter: ' + err.message);
    throw err;
  } finally {
    isGenerating = false;
  }
}

// Playback controls
playBtn.addEventListener('click', async () => {
  if (!outline.length) return;

  if (playingIndex === null) {
    if (selectedIndex !== null) playingIndex = selectedIndex;
    else playingIndex = outline.findIndex(o => o.chapterText) !== -1 ? outline.findIndex(o => o.chapterText) : 0;
  }

  if (playingIndex >= outline.length) return;

  if (!outline[playingIndex] || !outline[playingIndex].chapterText) {
    try {
      await generateChapter(playingIndex, true);
    } catch (e) {
      return;
    }
  }

  speakChapter(playingIndex);
  const nextIdx = playingIndex + 1;
  if (nextIdx < outline.length && !outline[nextIdx].chapterText) {
    generateChapter(nextIdx, false).catch(err => console.error('Background generation failed', err));
  }
});

pauseBtn.addEventListener('click', () => {
  if (synth.speaking) {
    if (synth.paused) synth.resume();
    else synth.pause();
  }
});

stopBtn.addEventListener('click', () => {
  synth.cancel();
  currentUtterance = null;
  playingIndex = null;
});

function speakChapter(idx) {
  const item = outline[idx];
  if (!item || !item.chapterText) return;

  // stop current
  synth.cancel();

  // highlight the chapter being spoken
  selectOutlineIndex(idx);

  const utter = new SpeechSynthesisUtterance(item.chapterText);
  const selectedVoiceName = voiceSelect.value;
  const voices = synth.getVoices();
  const v = voices.find(x => x.name === selectedVoiceName);
  if (v) utter.voice = v;

  utter.onend = () => {
    // when a chapter finishes, automatically play next (if exists)
    playingIndex = idx + 1;
    if (playingIndex < outline.length) {
      // only autoplay if enabled
      if (autoplayCheckbox && !autoplayCheckbox.checked) {
        // do nothing
        return;
      }
      // ensure next is generated (generate in background if needed) and then speak it
      if (outline[playingIndex].chapterText) {
        // small timeout to allow background tasks to settle
        setTimeout(() => speakChapter(playingIndex), 200);
      } else {
        generateChapter(playingIndex, true).then(() => speakChapter(playingIndex)).catch(err => {
          console.error('Failed to generate next chapter for playback', err);
        });
      }
    } else {
      // finished all
      playingIndex = null;
    }
  };

  utter.onerror = (e) => console.error('Speech error', e);

  currentUtterance = utter;
  synth.speak(utter);
}

// OpenAI helper (simple fetch to chat completions)
async function callOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || 'gpt-3.5-turbo',
    messages: messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: typeof opts.max_tokens === 'number' ? opts.max_tokens : (opts.max_tokens || 800)
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let errText = `OpenAI API returned ${res.status}`;
    try {
      const errData = await res.json();
      errText = errData.error?.message || errText;
    } catch (e) {
      // ignore
    }
    throw new Error(errText);
  }

  const data = await res.json();
  if (!data.choices || !data.choices.length || !data.choices[0].message) {
    throw new Error('Invalid response from OpenAI');
  }

  return data.choices[0].message.content;
}
