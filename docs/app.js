// Store API key in localStorage for convenience
// Note: localStorage is appropriate for this client-side-only app where the API key
// is used directly from the browser to call OpenAI's API. The key never goes to our servers.
// Users should be aware that localStorage is accessible to any script on the same origin.
const API_KEY_STORAGE = 'chatgpt_api_key';
// Key from Requirements.md to store/restore the last story prompt
const STORY_PROMPT_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.storyprompt';
// Store last selected voice
const VOICE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.voice';
// Store TTS provider and OpenAI voice
const TTS_PROVIDER_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.ttsprovider';
const OPENAI_VOICE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.openaivoice';
const OPENAI_INSTRUCTIONS_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.openaiinstructions';
const MODEL_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.model';
// Store the complete story state (outline, chapters, metadata)
const STORY_STATE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.storystate';
// Store settings (autoplay, language, system prompts)
const SETTINGS_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.settings';

// DOM elements
const modelSelect = document.getElementById('model-select');
const outlineSystemPromptInput = document.getElementById('outline-system-prompt');
const chapterSystemPromptInput = document.getElementById('chapter-system-prompt');
const storyPromptInput = document.getElementById('story-prompt');
const generateOutlineBtn = document.getElementById('generate-outline');
const newStoryBtn = document.getElementById('new-story');
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
// TTS provider controls (will be initialized on DOMContentLoaded)
let ttsProviderSelect = document.getElementById('tts-provider');
let openaiVoiceSelect = document.getElementById('openai-voice-select');
let openaiVoiceContainer = document.getElementById('openai-voice-container');
let openaiInstructionsSelect = document.getElementById('openai-instructions-select');
const activityLog = document.getElementById('activity-log');

// Activity logging helpers
function logActivity(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}\n`;
    if (activityLog) {
        activityLog.value += logMessage;
        // Auto-scroll to bottom
        activityLog.scrollTop = activityLog.scrollHeight;
    }
    console.log(message);
}

function logError(message, error) {
    const errorMsg = error ? `${message}: ${error.message || String(error)}` : message;
    logActivity(`❌ ERROR: ${errorMsg}`);
    console.error(message, error);
}

// This array will be replaced with contents of ./prompts/storyprompt-examples.json if available
let loadedExamples = [];

let outline = []; // {title, description, details, chapterText (optional)}
let storyTitle = null; // Book title from outline generation
let storySubtitle = null; // Book subtitle from outline generation
let storyDescription = null; // Book description from outline generation
let storyCharacters = null; // Main characters from outline generation (array of {name, description})
let selectedIndex = null;
let isGenerating = false;
let synth = window.speechSynthesis;
let currentUtterance = null;
let playingIndex = null;

// OpenAI audio playback element (when using OpenAI TTS)
let openaiAudio = null; // HTMLAudioElement
let openaiAudioUrl = null; // object URL for current audio blob

// Wake Lock object (null when not active)
let wakeLock = null;

// Helpers: API key stored only in localStorage; UI input removed per request
function setApiKey(key) {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
}

function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || null;
}

// Save complete story state to localStorage
function saveStoryState() {
    try {
        const state = {
            outline: outline,
            storyTitle: storyTitle,
            storySubtitle: storySubtitle,
            storyDescription: storyDescription,
            storyCharacters: storyCharacters,
            selectedIndex: selectedIndex,
            timestamp: Date.now()
        };
        localStorage.setItem(STORY_STATE_STORAGE, JSON.stringify(state));
        logActivity('💾 Story state saved to local storage');
    } catch (e) {
        console.warn('Could not save story state:', e);
        logError('Failed to save story state', e);
    }
}

// Load story state from localStorage
function loadStoryState() {
    try {
        const stored = localStorage.getItem(STORY_STATE_STORAGE);
        if (!stored) return false;

        const state = JSON.parse(stored);
        outline = state.outline || [];
        storyTitle = state.storyTitle || null;
        storySubtitle = state.storySubtitle || null;
        storyDescription = state.storyDescription || null;
        storyCharacters = state.storyCharacters || null;
        selectedIndex = state.selectedIndex || null;

        renderOutline();
        if (selectedIndex !== null && outline[selectedIndex]) {
            selectOutlineIndex(selectedIndex);
        } else if (outline.length > 0) {
            showMessageInChapterContainer('<div class="placeholder">Story loaded. Select a chapter to view or generate.</div>');
        }

        const date = state.timestamp ? new Date(state.timestamp).toLocaleString() : 'unknown';
        logActivity(`📂 Story state loaded from local storage (saved: ${date})`);
        return true;
    } catch (e) {
        console.warn('Could not load story state:', e);
        logError('Failed to load story state', e);
        return false;
    }
}

// Save settings to localStorage
function saveSettings() {
    try {
        const settings = {
            autoplay: autoplayCheckbox ? autoplayCheckbox.checked : true,
            language: languageSelect ? languageSelect.value : '',
            outlineSystemPrompt: outlineSystemPromptInput ? outlineSystemPromptInput.value : '',
            chapterSystemPrompt: chapterSystemPromptInput ? chapterSystemPromptInput.value : ''
        };
        localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
    } catch (e) {
        console.warn('Could not save settings:', e);
    }
}

// Load settings from localStorage
function loadSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE);
        if (!stored) return false;

        const settings = JSON.parse(stored);
        if (autoplayCheckbox && typeof settings.autoplay === 'boolean') {
            autoplayCheckbox.checked = settings.autoplay;
        }
        if (languageSelect && settings.language) {
            languageSelect.value = settings.language;
        }
        // System prompts will be loaded later from files, don't restore them
        return true;
    } catch (e) {
        console.warn('Could not load settings:', e);
        return false;
    }
}

// Reset story (clear outline, chapters, and metadata)
function resetStory() {
    outline = [];
    storyTitle = null;
    storySubtitle = null;
    storyDescription = null;
    storyCharacters = null;
    selectedIndex = null;
    playingIndex = null;

    renderOutline();
    showMessageInChapterContainer('<div class="placeholder">Story reset. Generate a new outline to start.</div>');

    try {
        localStorage.removeItem(STORY_STATE_STORAGE);
        logActivity('🗑️ Story reset - all chapters and outline cleared');
    } catch (e) {
        console.warn('Could not clear story state from storage:', e);
    }
}

// Update play button enabled/disabled state depending on generation/speaking
function updatePlayButtonState() {
    if (!playBtn) return;
    // Disabled if currently generating or speech synthesis is speaking or OpenAI audio playing
    const openaiPlaying = openaiAudio && !openaiAudio.paused && !openaiAudio.ended;
    playBtn.disabled = !!isGenerating || !!synth.speaking || !!openaiPlaying;
}

// Persist voice selection when user changes it
if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
        try {
            localStorage.setItem(VOICE_STORAGE, voiceSelect.value || '');
        } catch (e) {
        }
    });
}

// Prompt for API key if not present; load default prompts; populate voices & languages
window.addEventListener('DOMContentLoaded', async () => {
    // Ensure TTS controls exist in the DOM (in case index.html wasn't updated)
    ensureTTSControls();

    // Re-bind elements (they might have been created dynamically above)
    ttsProviderSelect = document.getElementById('tts-provider');
    openaiVoiceSelect = document.getElementById('openai-voice-select');
    openaiVoiceContainer = document.getElementById('openai-voice-container');
    openaiInstructionsSelect = document.getElementById('openai-instructions-select');

    let apiKey = getApiKey();
    if (!apiKey) {
        const entered = prompt('Please enter your OpenAI API key (will be stored in localStorage at "chatgpt_api_key"):');
        if (entered) setApiKey(entered.trim());
    }

    logActivity('Application started');

    // Load saved story state if available
    loadStoryState();

    // Load saved settings
    loadSettings();

    // Restore model selection
    try {
        const storedModel = localStorage.getItem(MODEL_STORAGE);
        if (storedModel && modelSelect) {
            modelSelect.value = storedModel;
        }
    } catch (e) {
        console.warn('Could not restore model selection:', e);
    }

    // Save model selection on change
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(MODEL_STORAGE, modelSelect.value || '');
                logActivity(`Model changed to: ${modelSelect.value}`);
            } catch (e) {
                console.warn('Could not save model selection:', e);
            }
        });
    }

    // Load default system prompts from files
    try {
        const [outlineTxt, chapterTxt, examplesJson] = await Promise.all([
            fetch('./prompts/outline.md').then(r => r.ok ? r.text() : '').catch(() => ''),
            fetch('./prompts/chapter.md').then(r => r.ok ? r.text() : '').catch(() => ''),
            fetch('./prompts/storyprompt-examples.json').then(r => r.ok ? r.json() : []).catch(() => []),
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

    // Restore TTS provider, OpenAI voice, and instructions selection
    try {
        const prov = localStorage.getItem(TTS_PROVIDER_STORAGE) || 'browser';
        if (ttsProviderSelect) {
            ttsProviderSelect.value = prov;
            toggleOpenAIVoiceContainer(prov === 'openai');
        }
        const oa = localStorage.getItem(OPENAI_VOICE_STORAGE) || '';
        if (openaiVoiceSelect && oa) openaiVoiceSelect.value = oa;
        const instr = localStorage.getItem(OPENAI_INSTRUCTIONS_STORAGE) || '';
        if (openaiInstructionsSelect && instr) openaiInstructionsSelect.value = instr;
    } catch (e) {
        console.warn('Could not restore TTS provider selection:', e);
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
                try {
                    localStorage.setItem(STORY_PROMPT_STORAGE, val);
                } catch (e) {/*ignore*/
                }
            }
        });
    }

    // Save story prompt on input (debounced)
    if (storyPromptInput) {
        let t = null;
        storyPromptInput.addEventListener('input', () => {
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                try {
                    localStorage.setItem(STORY_PROMPT_STORAGE, storyPromptInput.value || '');
                } catch (e) {
                }
            }, 400);
        });
    }

    // TTS provider selection handling
    if (ttsProviderSelect) {
        ttsProviderSelect.addEventListener('change', () => {
            const val = ttsProviderSelect.value;
            toggleOpenAIVoiceContainer(val === 'openai');
            try {
                localStorage.setItem(TTS_PROVIDER_STORAGE, val);
            } catch (e) {
            }
            updatePlayButtonState();
        });
    }

    if (openaiVoiceSelect) {
        openaiVoiceSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(OPENAI_VOICE_STORAGE, openaiVoiceSelect.value || '');
            } catch (e) {
            }
        });
    }

    if (openaiInstructionsSelect) {
        openaiInstructionsSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(OPENAI_INSTRUCTIONS_STORAGE, openaiInstructionsSelect.value || '');
            } catch (e) {
            }
        });
    }

    // Populate voices and language selector
    populateVoicesAndLanguages();
    window.speechSynthesis.onvoiceschanged = populateVoicesAndLanguages;

    // Save settings when changed
    if (autoplayCheckbox) {
        autoplayCheckbox.addEventListener('change', () => {
            saveSettings();
        });
    }

    // update play button state on load
    updatePlayButtonState();

    // set up auto-resize behavior for textareas: expand to 10 rows on focus, restore on blur
    try {
        setupTextareaAutoResize();
    } catch (e) { /* non-fatal */
    }
});

// Expand a textarea to 10 rows on focus and restore original rows on blur
function setupTextareaAutoResize() {
    const areas = Array.from(document.querySelectorAll('textarea'));
    areas.forEach(area => {
        // store original rows (as number)
        const orig = parseInt(area.getAttribute('rows') || area.rows || 3, 10) || 3;
        area.dataset.origRows = String(orig);

        area.addEventListener('focus', () => {
            try {
                area.rows = 10;
            } catch (e) {
            }
        });

        area.addEventListener('blur', () => {
            try {
                area.rows = parseInt(area.dataset.origRows || String(orig), 10);
            } catch (e) {
            }
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
    const storedSelection = (function () {
        try {
            return localStorage.getItem(VOICE_STORAGE) || '';
        } catch (e) {
            return '';
        }
    })();
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
            try {
                localStorage.setItem(VOICE_STORAGE, voiceSelect.value || '');
            } catch (e) {
            }
        }
    }
}

if (languageSelect) {
    languageSelect.addEventListener('change', () => {
        refreshVoiceSelect();
        saveSettings();
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

// Return the currently selected language code (e.g., 'en', 'de') or null
function getLanguageCode() {
    try {
        const v = (languageSelect && languageSelect.value) || '';
        return v ? v : null;
    } catch (e) {
        return null;
    }
}

// Show/hide OpenAI voice container based on TTS provider selection
function toggleOpenAIVoiceContainer(show) {
    if (!openaiVoiceContainer) return;
    if (show) openaiVoiceContainer.classList.remove('d-none');
    else openaiVoiceContainer.classList.add('d-none');
}

// Truncate text to max 4096 characters, ending at the last complete sentence
function truncateToSentence(text, maxLength = 4096) {
    if (text.length <= maxLength) return text;

    // Find the last sentence-ending punctuation before the limit
    const truncated = text.substring(0, maxLength);
    const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];

    let lastSentenceEnd = -1;
    for (const ender of sentenceEnders) {
        const pos = truncated.lastIndexOf(ender);
        if (pos > lastSentenceEnd) {
            lastSentenceEnd = pos + ender.length - 1; // Include the punctuation but not the space/newline
        }
    }

    // If no sentence ending found, just cut at maxLength
    if (lastSentenceEnd === -1) {
        return truncated;
    }

    return text.substring(0, lastSentenceEnd + 1);
}

// Request a screen wake lock to keep the display on (works on supported Android browsers)
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return; // not supported
    try {
        // If already have one, don't re-request
        if (wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock acquired');
        // If the lock is released by the UA (e.g., due to visibilitychange), clear reference
        wakeLock.addEventListener('release', () => {
            console.log('Wake Lock released by UA');
            wakeLock = null;
        });
    } catch (err) {
        console.warn('Could not acquire wake lock:', err && err.message ? err.message : err);
        wakeLock = null;
    }
}

// Release the wake lock if held
async function releaseWakeLock() {
    if (!wakeLock) return;
    try {
        await wakeLock.release();
    } catch (err) {
        console.warn('Error releasing wake lock:', err);
    }
    wakeLock = null;
}

// Try to re-request the wake lock if it was released when the page becomes visible again
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        // attempt to re-acquire if speech is ongoing
        if (synth.speaking) {
            try {
                await requestWakeLock();
            } catch (e) {
                // ignore
            }
        }
    }
});

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
            logError('Outline generation cancelled: No API key');
            return;
        }
    }

    const storyPrompt = (storyPromptInput && storyPromptInput.value || '').trim();
    if (!storyPrompt) {
        if (foreground) alert('Please enter the story prompt.');
        isGenerating = false;
        updatePlayButtonState();
        logError('Outline generation cancelled: No story prompt');
        return;
    }

    let systemPrompt = (outlineSystemPromptInput.value || '').trim();
    if (!systemPrompt) systemPrompt = 'You are an assistant that returns a numbered outline of chapters for a story. Return each chapter on its own line like "1. Chapter Title - short description".';

    generateOutlineBtn.disabled = true;
    if (foreground) showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating outline…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

    const selectedModel = (modelSelect && modelSelect.value) || 'gpt-5';
    logActivity(`🎬 Starting outline generation with model: ${selectedModel}`);

    try {
        const languageCode = getLanguageCode();
        const result = await window.StoryGenerator.generateOutline(apiKey, storyPrompt, systemPrompt, languageCode, selectedModel);
        storyTitle = result.title;
        storySubtitle = result.subtitle;
        storyDescription = result.description;
        storyCharacters = result.characters;
        outline = result.chapters;
        renderOutline();
        if (foreground) showMessageInChapterContainer('<div class="placeholder">Outline generated. Select a chapter to generate it.</div>');
        logActivity(`✅ Outline generated successfully: "${storyTitle}" with ${outline.length} chapters`);
        saveStoryState(); // Save after successful generation
        return outline;
    } catch (err) {
        console.error(err);
        logError('Outline generation failed', err);
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
    logActivity('📋 Generate Outline button pressed');
    try {
        await generateOutline(true);
    } catch (e) {
        // already shown by generateOutline
    }
});

// New Story button - reset everything
newStoryBtn.addEventListener('click', () => {
    const confirmed = confirm('Are you sure you want to start a new story? This will clear the current outline and all generated chapters.');
    if (confirmed) {
        logActivity('🆕 New Story button pressed');
        // Stop any ongoing playback
        try {
            synth.cancel();
        } catch (e) {
            // ignore
        }
        if (openaiAudio) {
            try {
                openaiAudio.pause();
                openaiAudio.currentTime = 0;
            } catch (e) {
            }
        }
        resetStory();
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

    // Display book metadata at the top if available
    if (storyTitle || storySubtitle || storyDescription || (storyCharacters && storyCharacters.length)) {
        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'list-group-item';
        metadataDiv.style.backgroundColor = '#f8f9fa';

        let metadataHtml = '';
        if (storyTitle) {
            metadataHtml += `<h5 class="mb-1">${escapeHtml(storyTitle)}</h5>`;
        }
        if (storySubtitle) {
            metadataHtml += `<h6 class="mb-2 text-muted">${escapeHtml(storySubtitle)}</h6>`;
        }
        if (storyDescription) {
            metadataHtml += `<p class="mb-2">${escapeHtml(storyDescription)}</p>`;
        }
        if (storyCharacters && storyCharacters.length) {
            metadataHtml += `<div class="mt-2"><strong>Main Characters:</strong><ul class="mb-0 mt-1">`;
            storyCharacters.forEach(char => {
                metadataHtml += `<li><strong>${escapeHtml(char.name)}</strong>: ${escapeHtml(char.description)}</li>`;
            });
            metadataHtml += `</ul></div>`;
        }

        metadataDiv.innerHTML = metadataHtml;
        outlineList.appendChild(metadataDiv);
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
    // highlight selection - account for metadata div at index 0 if present
    const metadataOffset = (storyTitle || storySubtitle || storyDescription || (storyCharacters && storyCharacters.length)) ? 1 : 0;
    Array.from(outlineList.children).forEach((c, i) => {
        // Chapter at index 'idx' in outline array is at DOM index 'idx + metadataOffset'
        c.classList.toggle('active', i === idx + metadataOffset);
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
        logActivity('❌ Generate chapter failed: No chapter selected');
        return;
    }
    logActivity(`📝 Generate Selected Chapter button pressed for chapter ${selectedIndex + 1}`);
    await generateChapter(selectedIndex, true);
});

generateNextBgBtn.addEventListener('click', async () => {
    if (!outline.length) {
        alert('No outline available. Generate one first.');
        logActivity('❌ Generate next in background failed: No outline');
        return;
    }
    const next = outline.findIndex((o) => !o.chapterText);
    if (next === -1) {
        alert('All chapters already generated.');
        logActivity('ℹ️ All chapters already generated');
        return;
    }
    logActivity(`🔄 Generate Next in Background button pressed for chapter ${next + 1}`);
    // start background generation
    generateChapter(next, false).catch(err => {
        console.error('Background generation failed', err);
        logError(`Background generation of chapter ${next + 1} failed`, err);
    });
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
            logError('Chapter generation cancelled: No API key');
            return;
        }
    }

    const item = outline[idx];
    if (!item) {
        isGenerating = false;
        updatePlayButtonState();
        logError(`Chapter generation failed: No item at index ${idx}`);
        return;
    }

    let systemPrompt = (chapterSystemPromptInput.value || '').trim();
    if (!systemPrompt) systemPrompt = 'You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.';

    const selectedModel = (modelSelect && modelSelect.value) || 'gpt-5';
    const mode = foreground ? 'foreground' : 'background';
    logActivity(`📝 Starting chapter generation (${mode}): ${idx + 1}. "${item.title}" with model: ${selectedModel}`);

    if (foreground) showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating chapter…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

    try {
        const languageCode = getLanguageCode();
        // Get prior chapters (all chapters before the current index)
        const priorChapters = outline.slice(0, idx);
        const storyPrompt = (storyPromptInput && storyPromptInput.value || '').trim();

        // Prepare book metadata
        const bookMetadata = {
            title: storyTitle,
            subtitle: storySubtitle,
            description: storyDescription,
            characters: storyCharacters
        };

        const resp = await window.StoryGenerator.generateChapter(
            apiKey,
            item,
            systemPrompt,
            priorChapters,
            storyPrompt,
            languageCode,
            bookMetadata,
            selectedModel
        );

        item.chapterText = resp;

        if (selectedIndex === idx) selectOutlineIndex(idx);
        logActivity(`✅ Chapter ${idx + 1} generated successfully (${mode}): "${item.title}"`);
        saveStoryState(); // Save after successful generation
        return resp;
    } catch (err) {
        console.error(err);
        logError(`Chapter ${idx + 1} generation failed (${mode})`, err);
        if (foreground) showError('Failed to generate chapter: ' + err.message);
        throw err;
    } finally {
        isGenerating = false;
        updatePlayButtonState();
    }
}

// Playback controls
playBtn.addEventListener('click', async () => {
    logActivity('▶️ Play button pressed');
    // Request wake lock before playing (best-effort)
    try {
        await requestWakeLock();
    } catch (e) {
        // ignore failures; playback should still proceed
    }

    // If there's no outline yet, generate it first (foreground so user sees spinner)
    if (!outline.length) {
        logActivity('📋 No outline found, generating...');
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
        logActivity(`📝 Chapter ${playingIndex + 1} not generated, generating now...`);
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
        logActivity(`🔄 Starting background generation for chapter ${nextIdx + 1}`);
        generateChapter(nextIdx, false).catch(err => {
            console.error('Background generation failed', err);
            logError(`Background generation of chapter ${nextIdx + 1} failed`, err);
        });
    }
});

pauseBtn.addEventListener('click', () => {
    logActivity('⏸️ Pause/Resume button pressed');
    const provider = (ttsProviderSelect && ttsProviderSelect.value) || 'browser';
    if (provider === 'openai') {
        if (openaiAudio) {
            if (openaiAudio.paused) openaiAudio.play();
            else openaiAudio.pause();
        }
    } else {
        if (synth.speaking) {
            if (synth.paused) synth.resume();
            else synth.pause();
        }
    }
});

stopBtn.addEventListener('click', async () => {
    logActivity('⏹️ Stop button pressed');
    // Stop both possible playback mechanisms
    try {
        synth.cancel();
    } catch (e) {
        // ignore
    }
    if (openaiAudio) {
        try {
            openaiAudio.pause();
            openaiAudio.currentTime = 0;
        } catch (e) {
        }
        if (openaiAudioUrl) {
            try { URL.revokeObjectURL(openaiAudioUrl); } catch (e) {}
            openaiAudioUrl = null;
        }
        openaiAudio = null;
    }

    currentUtterance = null;
    playingIndex = null;
    // Release wake lock when stopping playback
    try {
        await releaseWakeLock();
    } catch (e) {
        // ignore
    }
    updatePlayButtonState();
});

function speakChapter(idx) {
    const provider = (ttsProviderSelect && ttsProviderSelect.value) || 'browser';
    if (provider === 'openai') {
        speakChapterWithOpenAI(idx);
    } else {
        speakChapterWithBrowser(idx);
    }
}

function speakChapterWithBrowser(idx) {
    const item = outline[idx];
    if (!item || !item.chapterText) return;

    // stop current
    synth.cancel();

    // highlight the chapter being spoken
    selectOutlineIndex(idx);
    logActivity(`🔊 Speaking chapter ${idx + 1} with browser TTS: "${item.title}"`);

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
        try {
            if (v.lang) utter.lang = v.lang;
        } catch (e) {
        }
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
        logActivity(`✅ Finished speaking chapter ${idx + 1}: "${item.title}"`);
        playingIndex = idx + 1;
        updatePlayButtonState();
        if (playingIndex < outline.length) {
            // only autoplay if enabled
            if (autoplayCheckbox && !autoplayCheckbox.checked) {
                logActivity(`⏸️ Autoplay disabled, stopping at chapter ${playingIndex}`);
                return;
            }
            // ensure next is generated (generate in background if needed) and then speak it
            if (outline[playingIndex].chapterText) {
                // small timeout to allow background tasks to settle
                setTimeout(() => speakChapter(playingIndex), 200);
            } else {
                // Chapter not ready - wait for it to be generated
                logActivity(`⏳ Waiting for chapter ${playingIndex + 1} to be generated...`);
                generateChapter(playingIndex, true).then(() => {
                    logActivity(`▶️ Continuing autoplay with chapter ${playingIndex + 1}`);
                    speakChapter(playingIndex);
                }).catch(err => {
                    logError(`Failed to generate chapter ${playingIndex + 1} for autoplay`, err);
                });
            }
        } else {
            // finished all - release wake lock
            logActivity(`🎉 All chapters completed!`);
            try {
                releaseWakeLock();
            } catch (e) {
                // ignore
            }
            playingIndex = null;
        }
    };

    utter.onerror = (e) => {
        logError(`Speech error on chapter ${idx + 1}`, e);
        console.error('Speech error', e);
    };

    currentUtterance = utter;
    updatePlayButtonState();
    synth.speak(utter);
}

async function speakChapterWithOpenAI(idx) {
    const item = outline[idx];
    if (!item || !item.chapterText) return;

    // stop browser synth if running
    try { synth.cancel(); } catch (e) {}

    // highlight the chapter being spoken
    selectOutlineIndex(idx);
    logActivity(`🔊 Speaking chapter ${idx + 1} with OpenAI TTS: "${item.title}"`);

    const apiKey = getApiKey();
    if (!apiKey) {
        const entered = prompt('OpenAI API key not found. Please enter it:');
        if (entered) setApiKey(entered.trim());
    }
    const key = getApiKey();
    if (!key) {
        showError('OpenAI API key required for OpenAI TTS');
        logError('OpenAI TTS failed: No API key');
        return;
    }

    const voice = (openaiVoiceSelect && openaiVoiceSelect.value) || 'alloy';
    const instructions = (openaiInstructionsSelect && openaiInstructionsSelect.value) || '';

    try {
        // Truncate text to 4096 characters at last sentence boundary
        const text = truncateToSentence(item.chapterText, 4096);
        if (text.length < item.chapterText.length) {
            console.warn(`Chapter text truncated from ${item.chapterText.length} to ${text.length} characters`);
            logActivity(`⚠️ Chapter ${idx + 1} text truncated from ${item.chapterText.length} to ${text.length} characters`);
        }

        showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div class="placeholder">Fetching audio from OpenAI…</div>`);
        const buffer = await fetchOpenAITTS(text, voice, instructions, key);
        if (!buffer) {
            throw new Error('No audio returned from OpenAI');
        }

        // create blob and object URL
        const blob = new Blob([buffer], {type: 'audio/mpeg'});
        if (openaiAudioUrl) {
            try { URL.revokeObjectURL(openaiAudioUrl); } catch (e) {}
            openaiAudioUrl = null;
        }
        openaiAudioUrl = URL.createObjectURL(blob);
        if (openaiAudio) {
            try { openaiAudio.pause(); } catch (e) {}
            openaiAudio = null;
        }
        openaiAudio = new Audio(openaiAudioUrl);
        openaiAudio.crossOrigin = 'anonymous';

        openaiAudio.onplay = () => updatePlayButtonState();
        openaiAudio.onpause = () => updatePlayButtonState();
        openaiAudio.onerror = (e) => {
            logError(`OpenAI audio playback error on chapter ${idx + 1}`, e);
            console.error('OpenAI audio playback error', e);
        };
        openaiAudio.onended = () => {
            logActivity(`✅ Finished speaking chapter ${idx + 1}: "${item.title}"`);
            playingIndex = idx + 1;
            updatePlayButtonState();
            if (playingIndex < outline.length) {
                if (autoplayCheckbox && !autoplayCheckbox.checked) {
                    logActivity(`⏸️ Autoplay disabled, stopping at chapter ${playingIndex}`);
                    return;
                }
                if (outline[playingIndex].chapterText) {
                    setTimeout(() => speakChapter(playingIndex), 200);
                } else {
                    logActivity(`⏳ Waiting for chapter ${playingIndex + 1} to be generated...`);
                    generateChapter(playingIndex, true).then(() => {
                        logActivity(`▶️ Continuing autoplay with chapter ${playingIndex + 1}`);
                        speakChapter(playingIndex);
                    }).catch(err => {
                        logError(`Failed to generate chapter ${playingIndex + 1} for autoplay`, err);
                    });
                }
            } else {
                logActivity(`🎉 All chapters completed!`);
                try { releaseWakeLock(); } catch (e) {}
                playingIndex = null;
            }
        };

        // start playback
        updatePlayButtonState();
        await openaiAudio.play();
    } catch (err) {
        console.error('OpenAI TTS error', err);
        logError('OpenAI TTS failed', err);
        showError('OpenAI TTS failed: ' + (err && err.message ? err.message : String(err)));
    }
}

async function fetchOpenAITTS(text, voice, instructions, apiKey) {
    // Call OpenAI TTS endpoint - return ArrayBuffer of audio (MP3)
    const payload = {
        model: 'gpt-4o-mini-tts',
        voice: voice,
        input: text
    };

    // Add instructions if provided
    if (instructions) {
        payload.instructions = instructions;
    }

    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!resp.ok) {
        const textErr = await resp.text();
        let msg = `OpenAI TTS error ${resp.status}: ${resp.statusText}`;
        try {
            const json = JSON.parse(textErr);
            msg = json.error?.message || msg;
        } catch (e) {
        }
        throw new Error(msg + '\n' + textErr);
    }

    return await resp.arrayBuffer();
}

// Insert TTS provider and OpenAI voice controls into the Playback card if missing
function ensureTTSControls() {
    try {
        if (document.getElementById('tts-provider')) return; // already present

        // Find the playback card-body by searching for a card with h5 text 'Playback'
        const cardBodies = Array.from(document.querySelectorAll('.card .card-body'));
        let playbackBody = null;
        for (const b of cardBodies) {
            const h5 = b.querySelector('h5.card-title');
            if (h5 && (h5.textContent || '').trim().toLowerCase() === 'playback') {
                playbackBody = b;
                break;
            }
        }
        if (!playbackBody) return;

        // Create provider select
        const provDiv = document.createElement('div');
        provDiv.className = 'mb-3';
        const provLabel = document.createElement('label');
        provLabel.htmlFor = 'tts-provider';
        provLabel.className = 'form-label';
        provLabel.textContent = 'TTS Provider';
        const provSelect = document.createElement('select');
        provSelect.id = 'tts-provider';
        provSelect.className = 'form-select';
        const optBrowser = document.createElement('option');
        optBrowser.value = 'browser';
        optBrowser.textContent = 'Browser (Web Speech API)';
        const optOpenAI = document.createElement('option');
        optOpenAI.value = 'openai';
        optOpenAI.textContent = 'OpenAI (gpt-4o-mini-tts)';
        provSelect.appendChild(optBrowser);
        provSelect.appendChild(optOpenAI);
        provDiv.appendChild(provLabel);
        provDiv.appendChild(provSelect);

        // Insert provider select before the existing voice-select (if present) or at end
        const existingVoice = playbackBody.querySelector('#voice-select');
        if (existingVoice && existingVoice.parentElement) {
            existingVoice.parentElement.insertBefore(provDiv, existingVoice.parentElement.firstChild);
        } else {
            playbackBody.appendChild(provDiv);
        }

        // Create OpenAI voice container
        const oaDiv = document.createElement('div');
        oaDiv.id = 'openai-voice-container';
        oaDiv.className = 'mt-3 d-none';

        // Voice select
        const oaLabel = document.createElement('label');
        oaLabel.htmlFor = 'openai-voice-select';
        oaLabel.className = 'form-label';
        oaLabel.textContent = 'OpenAI Voice';
        const oaSelect = document.createElement('select');
        oaSelect.id = 'openai-voice-select';
        oaSelect.className = 'form-select mb-3';
        const voices = ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer'];
        for (const v of voices) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            oaSelect.appendChild(o);
        }

        // Instructions select
        const instrLabel = document.createElement('label');
        instrLabel.htmlFor = 'openai-instructions-select';
        instrLabel.className = 'form-label';
        instrLabel.textContent = 'Voice Instructions';
        const instrSelect = document.createElement('select');
        instrSelect.id = 'openai-instructions-select';
        instrSelect.className = 'form-select';

        const instrOptions = [
            { value: '', label: 'Default' },
            { value: 'Speak in a calm, soothing whisper-tone, very softly and slowly, with long gentle pauses between sentences. Convey a restful, dreamy mood, as if telling a quiet bedtime story.', label: 'Good night story' },
            { value: 'Speak in an animated, warm, and engaging storyteller voice. Use a medium-pace tempo, clear enunciation, lively inflection, occasional dramatic pauses, and convey a tone of friendly intrigue and enjoyment. Use vocal variation to depict emotions, scene changes, or characters\' moods.', label: 'Story teller' }
        ];

        for (const opt of instrOptions) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            instrSelect.appendChild(o);
        }

        const hint = document.createElement('div');
        hint.className = 'form-text';
        hint.textContent = 'OpenAI TTS with gpt-4o-mini-tts. Text limited to 4096 chars.';

        oaDiv.appendChild(oaLabel);
        oaDiv.appendChild(oaSelect);
        oaDiv.appendChild(instrLabel);
        oaDiv.appendChild(instrSelect);
        oaDiv.appendChild(hint);

        // Insert after voice select if present
        if (existingVoice && existingVoice.parentElement) {
            existingVoice.parentElement.appendChild(oaDiv);
        } else {
            playbackBody.appendChild(oaDiv);
        }
    } catch (e) {
        console.warn('Could not inject TTS controls:', e);
    }
}
