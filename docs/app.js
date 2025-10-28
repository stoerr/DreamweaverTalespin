// Store API key in localStorage for convenience
// Note: localStorage is appropriate for this client-side-only app where the API key
// is used directly from the browser to call OpenAI's API. The key never goes to our servers.
// Users should be aware that localStorage is accessible to any script on the same origin.
const API_KEY_STORAGE = 'chatgpt_api_key';
// Key from Requirements.md to store/restore the last story prompt
const STORY_PROMPT_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.storyprompt';
// Store last selected voice
const VOICE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.voice';

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
const storyExamplesSelect = document.getElementById('story-examples');

// Example story prompts shown in the examples dropdown
const STORY_PROMPTS_EXAMPLES = [
  "A curious child discovers a hidden city beneath the ocean",
  "An inventor travels back in time to fix a mistake but creates unexpected consequences",
  "A small village learns its guardian is a forgotten robot",
  "A lonely librarian finds books that come to life at midnight",
  "Two rival space crews must cooperate to survive an unknown signal"
];

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

// Update play button enabled/disabled state depending on generation/speaking
function updatePlayButtonState() {
  if (!playBtn) return;
  // Disabled if currently generating or speech synthesis is speaking
  playBtn.disabled = !!isGenerating || !!synth.speaking;
}

// Persist voice selection when user changes it
if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    try { localStorage.setItem(VOICE_STORAGE, voiceSelect.value || ''); } catch (e) {}
  });
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
      fetch('./prompts/outline.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
      fetch('./prompts/chapter.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
    ]);
    if (outlineTxt) outlineSystemPromptInput.value = outlineTxt.trim();
    if (chapterTxt) chapterSystemPromptInput.value = chapterTxt.trim();
  } catch (e) {
    console.warn('Could not load prompt files:', e);
  }

  // Restore last story prompt if present
  try {
    const last = localStorage.getItem(STORY_PROMPT_STORAGE);
    if (last && storyPromptInput) storyPromptInput.value = last;
  } catch (e) {
    console.warn('Could not read stored story prompt:', e);
  }

  // Populate examples dropdown
  if (storyExamplesSelect) {
    storyExamplesSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(Select an example to fill the story prompt)';
    storyExamplesSelect.appendChild(placeholder);
    STORY_PROMPTS_EXAMPLES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      storyExamplesSelect.appendChild(opt);
    });
    storyExamplesSelect.addEventListener('change', () => {
      const val = storyExamplesSelect.value || '';
      if (val && storyPromptInput) {
        storyPromptInput.value = val;
        // save immediately
        try { localStorage.setItem(STORY_PROMPT_STORAGE, val); } catch(e){/*ignore*/}
      }
    });
  }

  // Save story prompt on input (debounced)
  if (storyPromptInput) {
    let t = null;
    storyPromptInput.addEventListener('input', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        try { localStorage.setItem(STORY_PROMPT_STORAGE, storyPromptInput.value || ''); } catch(e){}
      }, 400);
    });
  }

  // Populate voices and language selector
  populateVoicesAndLanguages();
  window.speechSynthesis.onvoiceschanged = populateVoicesAndLanguages;

  // update play button state on load
  updatePlayButtonState();

  // set up auto-resize behavior for textareas: expand to 10 rows on focus, restore on blur
  try { setupTextareaAutoResize(); } catch (e) { /* non-fatal */ }
});

// Expand a textarea to 10 rows on focus and restore original rows on blur
function setupTextareaAutoResize() {
  const areas = Array.from(document.querySelectorAll('textarea'));
  areas.forEach(area => {
    // store original rows (as number)
    const orig = parseInt(area.getAttribute('rows') || area.rows || 3, 10) || 3;
    area.dataset.origRows = String(orig);

    area.addEventListener('focus', () => {
      try { area.rows = 10; } catch (e) {}
    });

    area.addEventListener('blur', () => {
      try { area.rows = parseInt(area.dataset.origRows || String(orig), 10); } catch (e) {}
    });
  });
}

// Populate voices and languages
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
    // If user had a previous selection, restore it. Otherwise prefer English if available.
    if (prev) languageSelect.value = prev;
    else if (langs.includes('en')) languageSelect.value = 'en';
  }

  // Populate voiceSelect filtered by language
  refreshVoiceSelect();
}

function refreshVoiceSelect() {
  const voices = synth.getVoices();
  const lang = (languageSelect && languageSelect.value) || '';
  // remember previous selection and stored selection
  const prevSelection = voiceSelect ? voiceSelect.value : '';
  const storedSelection = (function(){ try { return localStorage.getItem(VOICE_STORAGE) || ''; } catch(e){ return ''; } })();
  voiceSelect.innerHTML = '';
  const filtered = voices.filter(v => {
    if (!lang) return true; // any
    const p = (v.lang || '').split('-')[0];
    return p === lang;
  });
  // If no voices match the language, fall back to all voices
  const toShow = filtered.length ? filtered : voices;

  // Sort voices by a simple quality heuristic: default and known high-quality providers first, then language match
  function voiceQualityScore(v) {
    let score = 0;
    if (v.default) score += 100;
    const name = (v.name || '').toLowerCase();
    // Heuristic provider/quality keywords
    if (name.includes('google') || name.includes('neural') || name.includes('premium') || name.includes('high')) score += 50;
    if (name.includes('microsoft') || name.includes('azure')) score += 40;
    // prefer exact language match
    if (languageSelect && languageSelect.value) {
      const p = (v.lang || '').split('-')[0];
      if (p === languageSelect.value) score += 20;
    }
    // shorter, clean names slightly preferred
    score += Math.max(0, 10 - (v.name || '').length * 0.1);
    return score;
  }

  toShow.sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a));
  toShow.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
    voiceSelect.appendChild(opt);
  });

  // Try to restore previous selection (current UI selection), then stored selection, otherwise select top
  if (voiceSelect.options.length) {
    if (prevSelection && Array.from(voiceSelect.options).some(o => o.value === prevSelection)) {
      voiceSelect.value = prevSelection;
    } else if (storedSelection && Array.from(voiceSelect.options).some(o => o.value === storedSelection)) {
      voiceSelect.value = storedSelection;
    } else {
      voiceSelect.selectedIndex = 0;
      try { localStorage.setItem(VOICE_STORAGE, voiceSelect.value || ''); } catch(e){}
    }
  }
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
async function generateOutline(foreground = true) {
  if (isGenerating) return;
  isGenerating = true;
  updatePlayButtonState();

  let apiKey = getApiKey();
  if (!apiKey) {
    const entered = prompt('OpenAI API key not found. Please enter it:');
    if (entered) setApiKey(entered.trim());
    apiKey = getApiKey();
    if (!apiKey) {
      isGenerating = false;
      updatePlayButtonState();
      return;
    }
  }

  const storyPrompt = (storyPromptInput && storyPromptInput.value || '').trim();
  if (!storyPrompt) {
    if (foreground) alert('Please enter the story prompt.');
    isGenerating = false;
    updatePlayButtonState();
    return;
  }

  let systemPrompt = (outlineSystemPromptInput.value || '').trim();
  if (!systemPrompt) systemPrompt = 'You are an assistant that returns a numbered outline of chapters for a story. Return each chapter on its own line like "1. Chapter Title - short description".';

  generateOutlineBtn.disabled = true;
  if (foreground) showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating outline…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

  try {
    const langInstr = getLanguageInstruction();
    const messages = [];
    if (langInstr) messages.push({ role: 'system', content: langInstr });
    messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: storyPrompt });

    const text = await callOpenAI(apiKey, messages);

    outline = parseOutline(text);
    renderOutline();
    if (foreground) showMessageInChapterContainer('<div class="placeholder">Outline generated. Select a chapter to generate it.</div>');
    return outline;
  } catch (err) {
    console.error(err);
    if (foreground) showError('Failed to generate outline: ' + err.message);
    throw err;
  } finally {
    isGenerating = false;
    generateOutlineBtn.disabled = false;
    updatePlayButtonState();
  }
}

// wire the UI button
generateOutlineBtn.addEventListener('click', async () => {
  try {
    await generateOutline(true);
  } catch (e) {
    // already shown by generateOutline
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
  updatePlayButtonState();
  let apiKey = getApiKey();
  if (!apiKey) {
    const entered = prompt('OpenAI API key not found. Please enter it:');
    if (entered) setApiKey(entered.trim());
    apiKey = getApiKey();
    if (!apiKey) {
      isGenerating = false;
      updatePlayButtonState();
      return;
    }
  }

  const item = outline[idx];
  if (!item) {
    isGenerating = false;
    updatePlayButtonState();
    return;
  }

  let systemPrompt = (chapterSystemPromptInput.value || '').trim();
  if (!systemPrompt) systemPrompt = 'You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.';
  const userContent = `Chapter: ${item.title}\nDescription: ${item.description}`;

  if (foreground) showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating chapter…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

  try {
    const langInstr = getLanguageInstruction();
    const messages = [];
    if (langInstr) messages.push({ role: 'system', content: langInstr });
    // chapter-writing system prompt
    messages.push({ role: 'system', content: systemPrompt });

    // Add prior chapters in alternating user/assistant messages
    // For each chapter i < idx: push user message with outline, then assistant message with chapter text (if available)
    for (let i = 0; i < idx; i++) {
      const prev = outline[i];
      if (!prev) continue;
      const prevUser = `Chapter: ${prev.title}\nDescription: ${prev.description}`;
      messages.push({ role: 'user', content: prevUser });
      if (prev.chapterText) {
        messages.push({ role: 'assistant', content: prev.chapterText });
      }
    }

    // Finally request the current chapter (as a user message)
    messages.push({ role: 'user', content: userContent });

    const resp = await callOpenAI(apiKey, messages);

    item.chapterText = (resp || '').trim();

    if (selectedIndex === idx) selectOutlineIndex(idx);
    return resp;
  } catch (err) {
    console.error(err);
    if (foreground) showError('Failed to generate chapter: ' + err.message);
    throw err;
  } finally {
    isGenerating = false;
    updatePlayButtonState();
  }
}

// Playback controls
playBtn.addEventListener('click', async () => {
  // If there's no outline yet, generate it first (foreground so user sees spinner)
  if (!outline.length) {
    try {
      await generateOutline(true);
    } catch (e) {
      // generation failed or was canceled; ensure UI state is consistent and bail
      updatePlayButtonState();
      return;
    }
    if (!outline.length) {
      // still no outline (user may have cancelled); nothing to play
      updatePlayButtonState();
      return;
    }
  }

  // disable play immediately while generation/prepare starts
  playBtn.disabled = true;

  if (playingIndex === null) {
    if (selectedIndex !== null) playingIndex = selectedIndex;
    else playingIndex = outline.findIndex(o => o.chapterText) !== -1 ? outline.findIndex(o => o.chapterText) : 0;
  }

  if (playingIndex >= outline.length) return;

  if (!outline[playingIndex] || !outline[playingIndex].chapterText) {
    try {
      await generateChapter(playingIndex, true);
    } catch (e) {
      updatePlayButtonState();
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
  updatePlayButtonState();
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

  // when speaking starts, update UI state
  utter.onstart = () => {
    updatePlayButtonState();
  };

  utter.onend = () => {
    // when a chapter finishes, automatically play next (if exists)
    playingIndex = idx + 1;
    updatePlayButtonState();
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
  updatePlayButtonState();
  synth.speak(utter);
}

// OpenAI helper (simple fetch to chat completions)
async function callOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || 'gpt-4o',
    messages: messages,
    temperature: opts.temperature ?? 1,
    max_completion_tokens: typeof opts.max_tokens === 'number' ? opts.max_tokens : 1024,
    // top_p: opts.top_p,
    // frequency_penalty: opts.frequency_penalty,
    // presence_penalty: opts.presence_penalty,
    // n: 1,
    // stream: false,
    // stop: null,
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
