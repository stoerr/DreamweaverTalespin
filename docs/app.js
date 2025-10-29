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

// This array will be replaced with contents of ./prompts/storyprompt-examples.json if available
let loadedExamples = [];

let outline = []; // {title, description, details, chapterText (optional)}
let storyTitle = null; // Book title from outline generation
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
    const [outlineTxt, chapterTxt, examplesJson] = await Promise.all([
      fetch('./prompts/outline.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
      fetch('./prompts/chapter.md').then(r => r.ok ? r.text() : '' ).catch(() => ''),
      fetch('./prompts/storyprompt-examples.json').then(r => r.ok ? r.json() : [] ).catch(() => []),
    ]);
    if (outlineTxt) outlineSystemPromptInput.value = outlineTxt.trim();
    if (chapterTxt) chapterSystemPromptInput.value = chapterTxt.trim();
    if (examplesJson && Array.isArray(examplesJson)) loadedExamples = examplesJson;
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
    loadedExamples.forEach(s => {
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
   // Build languages set from voice.lang (prefix before '-')
   // const langs = Array.from(new Set(voices.map(v => (v.lang || 'unknown').split('-')[0]))).filter(Boolean).sort();
   const langs = ['en', 'de', 'es', 'fr'];

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

  // Filter voices by language - more robust filtering for mobile (handle - and _ separators)
  const filtered = voices.filter(v => {
    if (!lang) return true; // any
    const voiceLang = (v.lang || '').toLowerCase();
    const langPrefix = voiceLang.split(/[-_]/)[0];
    const langLower = lang.toLowerCase();
    return langPrefix === langLower || voiceLang === langLower || voiceLang.startsWith(langLower + '-') || voiceLang.startsWith(langLower + '_');
  });

  // If no voices match the language, fall back to all voices
  const toShow = filtered.length ? filtered : voices;

  // Sort voices by a simple quality heuristic: default and known high-quality providers first, then language match
  function voiceQualityScore(v) {
    let score = 0;
    if (v.default) score += 100;
    const name = (v.name || '').toLowerCase();
    // Prefer localService voices where possible (more likely honored on mobile)
    if (v.localService) score += 30;
    if (name.includes('google') || name.includes('neural') || name.includes('premium') || name.includes('high')) score += 50;
    if (name.includes('microsoft') || name.includes('azure')) score += 40;
    // prefer exact language match
    if (languageSelect && languageSelect.value) {
      const p = (v.lang || '').toLowerCase().split(/[-_]/)[0];
      if (p === languageSelect.value.toLowerCase()) score += 20;
    }
    // shorter, clean names slightly preferred
    score += Math.max(0, 10 - (v.name || '').length * 0.1);
    return score;
  }

  toShow.sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a));
  toShow.forEach(v => {
    const opt = document.createElement('option');
    // Use voiceURI as the option value to uniquely identify voices across browsers (fallback to name)
    opt.value = v.voiceURI || v.name;
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

function getLanguageCode() {
  if (!languageSelect) return null;
  return languageSelect.value || null;
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
    const languageCode = getLanguageCode();
    const result = await window.StoryGenerator.generateOutline(apiKey, storyPrompt, systemPrompt, languageCode);
    storyTitle = result.title;
    outline = result.chapters;
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
    // Add chapter details as hover tooltip if available
    if (item.details) {
      el.title = item.details;
    }
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

  if (foreground) showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating chapter…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

  try {
    const languageCode = getLanguageCode();
    // Get prior chapters (all chapters before the current index)
    const priorChapters = outline.slice(0, idx);
    
    const resp = await window.StoryGenerator.generateChapter(
      apiKey,
      item,
      systemPrompt,
      priorChapters,
      languageCode
    );

    item.chapterText = resp;

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
  const selectedVoiceValue = voiceSelect.value;
  const voices = synth.getVoices();

  // Prefer matching by voiceURI (more stable/unique across platforms), then fall back to name matches
  let v = voices.find(x => x.voiceURI === selectedVoiceValue);

  // Fallback 1: Try case-insensitive match on voiceURI
  if (!v) {
    v = voices.find(x => (x.voiceURI || '').toLowerCase() === (selectedVoiceValue || '').toLowerCase());
  }

  // Fallback 2: Try exact name match
  if (!v) {
    v = voices.find(x => x.name === selectedVoiceValue);
  }

  // Fallback 3: Try case-insensitive name match
  if (!v) {
    v = voices.find(x => (x.name || '').toLowerCase() === (selectedVoiceValue || '').toLowerCase());
  }

  // Fallback 4: Try partial match
  if (!v) {
    v = voices.find(x => (x.name || '').includes(selectedVoiceValue) || (selectedVoiceValue || '').includes(x.name || ''));
  }

  if (v) {
    utter.voice = v;
    // Also hint the utterance language to increase chance the browser honors the selected voice
    try { if (v.lang) utter.lang = v.lang; } catch (e) {}
    console.log(`Using voice: ${v.name} (${v.lang})`);
  } else {
    console.warn(`Could not find voice "${selectedVoiceValue}", using browser default`);
  }

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
