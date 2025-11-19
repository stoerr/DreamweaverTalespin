// Store API key in localStorage for convenience
// Note: localStorage is appropriate for this client-side-only app where the API key
// is used directly from the browser to call OpenAI's API. The key never goes to our servers.
// Users should be aware that localStorage is accessible to any script on the same origin.
const API_KEY_STORAGE = 'chatgpt_api_key';
// Key from Requirements.md to store/restore the last story prompt
const STORY_PROMPT_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.storyprompt';
// Store last selected voice
// Store OpenAI TTS preferences
const OPENAI_VOICE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.openaivoice';
const OPENAI_INSTRUCTIONS_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.openaiinstructions';
const OPENAI_TTS_MODEL_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.openaimodel';
const MODEL_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.model';
// Store the complete story state (outline, chapters, metadata)
const STORY_STATE_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.storystate';
// Store settings (autoplay, language, system prompts)
const SETTINGS_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.settings';
// Store the current reading position (chapter index)
const READING_POSITION_STORAGE = 'net.stoerr.aiexperiments.DreamweaverTalespin.readingposition';

// DOM elements
const modelSelect = document.getElementById('model-select');
const outlineSystemPromptInput = document.getElementById('outline-system-prompt');
const chapterSystemPromptInput = document.getElementById('chapter-system-prompt');
const storyPromptInput = document.getElementById('story-prompt');
const generateOutlineBtn = document.getElementById('generate-outline');
const resetPromptsBtn = document.getElementById('reset-prompts');
const newStoryBtn = document.getElementById('new-story');
const outlineList = document.getElementById('outline-list');
const generateChapterBtn = document.getElementById('generate-chapter');
const generateNextBgBtn = document.getElementById('generate-next-bg');
const generateWholeStoryBtn = document.getElementById('generate-whole-story');
const chapterContainer = document.getElementById('chapter-container');
const playBtn = document.getElementById('play-btn');
const continueBtn = document.getElementById('continue-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const copyStoryBtn = document.getElementById('copy-story-btn');
const exportStoryBtn = document.getElementById('export-story-btn');
const importStoryBtn = document.getElementById('import-story-btn');
const languageSelect = document.getElementById('language-select');
const autoplayCheckbox = document.getElementById('autoplay');
const storyExamplesSelect = document.getElementById('story-examples');
const openaiVoiceSelect = document.getElementById('openai-voice-select');
const openaiInstructionsSelect = document.getElementById('openai-instructions-select');
const openaiInstructionsTextarea = document.getElementById('openai-instructions-textarea');
const openaiInstructionsGroup = document.getElementById('openai-instructions-group');
const openaiTTSModelSelect = document.getElementById('openai-tts-model-select');
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
    let errorMsg = message;
    if (error) {
        // Include detailed error information for debugging on mobile
        errorMsg += `: ${error.message || String(error)}`;
        if (error.stack) {
            errorMsg += `\nStack: ${error.stack}`;
        }
        // Include any additional error properties
        if (error.error) {
            errorMsg += `\nDetails: ${JSON.stringify(error.error)}`;
        }
        if (error.type) {
            errorMsg += `\nType: ${error.type}`;
        }
    }
    logActivity(`❌ ERROR: ${errorMsg}`);
    console.error(message, error);
}

// This array will be replaced with contents of ./prompts/storyprompt-examples.json if available
let loadedExamples = [];

// Store the default prompts loaded from files so we can reset them later
let defaultOutlinePrompt = '';
let defaultChapterPrompt = '';

let outline = []; // {title, description, details, chapterText (optional)}
let storyTitle = null; // Book title from outline generation
let storySubtitle = null; // Book subtitle from outline generation
let storyDescription = null; // Book description from outline generation
let storyCharacters = null; // Main characters from outline generation (array of {name, description})
let selectedIndex = null;
let isGenerating = false;
let generatingChapterIndex = null; // Track which chapter is being generated
let chapterGenerationPromise = null; // Promise for the current chapter generation
let playingIndex = null;
let currentParagraphs = [];
let currentParagraphChapterIdx = null;
let currentHighlightedParagraphIndex = null;
let isGeneratingWholeStory = false;

// OpenAI audio playback element (when using OpenAI TTS)
let openaiAudio = null; // HTMLAudioElement
let openaiAudioUrl = null; // object URL for current audio blob

function cleanupOpenAIAudio() {
    if (openaiAudio) {
        try {
            openaiAudio.pause();
        } catch (e) {
        }
        openaiAudio = null;
    }
    if (openaiAudioUrl) {
        try {
            URL.revokeObjectURL(openaiAudioUrl);
        } catch (e) {
        }
        openaiAudioUrl = null;
    }
}

function isOpenAIPlaying() {
    return !!(openaiAudio && !openaiAudio.paused && !openaiAudio.ended);
}

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

// Save reading position to localStorage
function saveReadingPosition(chapterIndex, charIndex = 0) {
    try {
        const position = { chapter: chapterIndex, char: charIndex };
        localStorage.setItem(READING_POSITION_STORAGE, JSON.stringify(position));
        if (charIndex > 0) {
            logActivity(`💾 Reading position saved: chapter ${chapterIndex + 1}, character ${charIndex}`);
        } else {
            logActivity(`💾 Reading position saved: chapter ${chapterIndex + 1}`);
        }
    } catch (e) {
        console.warn('Could not save reading position:', e);
    }
}

// Load reading position from localStorage
function loadReadingPosition() {
    try {
        const stored = localStorage.getItem(READING_POSITION_STORAGE);
        if (stored) {
            // Try to parse as new format (object with chapter and char)
            try {
                const position = JSON.parse(stored);
                if (typeof position === 'object' && position !== null &&
                    typeof position.chapter === 'number' && position.chapter >= 0) {
                    return {
                        chapter: position.chapter,
                        char: position.char || 0
                    };
                }
            } catch (e) {
                // Fall back to old format (just a number)
            }

            // Old format: just a chapter number
            const pos = parseInt(stored, 10);
            if (!isNaN(pos) && pos >= 0) {
                return { chapter: pos, char: 0 };
            }
        }
    } catch (e) {
        console.warn('Could not load reading position:', e);
    }
    return null;
}

// Clear reading position from localStorage
function clearReadingPosition() {
    try {
        localStorage.removeItem(READING_POSITION_STORAGE);
        logActivity('🗑️ Reading position cleared');
    } catch (e) {
        console.warn('Could not clear reading position:', e);
    }
}

function shouldUseCustomInstructionsTextarea() {
    return !!(openaiTTSModelSelect && openaiTTSModelSelect.value === 'gpt-4o-mini-tts');
}

function getCurrentVoiceInstructions() {
    if (shouldUseCustomInstructionsTextarea()) {
        return (openaiInstructionsTextarea && openaiInstructionsTextarea.value) || '';
    }
    return (openaiInstructionsSelect && openaiInstructionsSelect.value) || '';
}

function persistVoiceInstructions() {
    try {
        localStorage.setItem(OPENAI_INSTRUCTIONS_STORAGE, getCurrentVoiceInstructions());
    } catch (e) {
    }
}

function updateVoiceInstructionsUI() {
    if (!openaiInstructionsGroup) return;
    const model = openaiTTSModelSelect ? openaiTTSModelSelect.value : 'tts-1-hd';
    if (model === 'tts-1-hd') {
        openaiInstructionsGroup.classList.add('d-none');
    } else {
        openaiInstructionsGroup.classList.remove('d-none');
    }
    if (openaiInstructionsTextarea) {
        const showTextarea = model === 'gpt-4o-mini-tts';
        openaiInstructionsTextarea.classList.toggle('d-none', !showTextarea);
    }
}

function setWholeStoryGenerationState(running) {
    isGeneratingWholeStory = running;
    if (generateChapterBtn) generateChapterBtn.disabled = running;
    if (generateNextBgBtn) generateNextBgBtn.disabled = running;
    if (generateWholeStoryBtn) generateWholeStoryBtn.disabled = running;
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
        clearReadingPosition();
        logActivity('🗑️ Story reset - all chapters and outline cleared');
    } catch (e) {
        console.warn('Could not clear story state from storage:', e);
    }
}

// Update play button enabled/disabled state depending on generation/speaking
function updatePlayButtonState() {
    if (!playBtn) return;
    // Disabled if currently generating or OpenAI audio playing
    const openaiPlaying = isOpenAIPlaying();
    playBtn.disabled = !!isGenerating || openaiPlaying;
}

// Prompt for API key if not present; load default prompts; populate voices & languages
window.addEventListener('DOMContentLoaded', async () => {
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
        if (outlineTxt) {
            defaultOutlinePrompt = outlineTxt.trim();
            outlineSystemPromptInput.value = defaultOutlinePrompt;
        }
        if (chapterTxt) {
            defaultChapterPrompt = chapterTxt.trim();
            chapterSystemPromptInput.value = defaultChapterPrompt;
        }
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

    // Restore OpenAI TTS preferences
    try {
        const oa = localStorage.getItem(OPENAI_VOICE_STORAGE) || '';
        if (openaiVoiceSelect && oa) openaiVoiceSelect.value = oa;
        const instr = localStorage.getItem(OPENAI_INSTRUCTIONS_STORAGE) || '';
        if (openaiInstructionsTextarea) openaiInstructionsTextarea.value = instr;
        if (openaiInstructionsSelect) {
            const optionExists = Array.from(openaiInstructionsSelect.options).some(opt => opt.value === instr);
            openaiInstructionsSelect.value = optionExists ? instr : '';
        }
        const storedTTSModel = localStorage.getItem(OPENAI_TTS_MODEL_STORAGE) || '';
        if (openaiTTSModelSelect && storedTTSModel) openaiTTSModelSelect.value = storedTTSModel;
    } catch (e) {
        console.warn('Could not restore OpenAI TTS selection:', e);
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
            if (shouldUseCustomInstructionsTextarea()) {
                if (openaiInstructionsTextarea) {
                    openaiInstructionsTextarea.value = openaiInstructionsSelect.value || '';
                }
            }
            persistVoiceInstructions();
        });
    }

    if (openaiInstructionsTextarea) {
        openaiInstructionsTextarea.addEventListener('input', () => {
            persistVoiceInstructions();
        });
    }

    if (openaiTTSModelSelect) {
        openaiTTSModelSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(OPENAI_TTS_MODEL_STORAGE, openaiTTSModelSelect.value || '');
            } catch (e) {
            }
            updateVoiceInstructionsUI();
            if (shouldUseCustomInstructionsTextarea() && openaiInstructionsTextarea && !openaiInstructionsTextarea.value && openaiInstructionsSelect) {
                openaiInstructionsTextarea.value = openaiInstructionsSelect.value || '';
                persistVoiceInstructions();
            }
        });
    }

    updateVoiceInstructionsUI();

    // Populate language selector
    populateLanguageOptions();

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

// Populate languages available to the generator UI
function populateLanguageOptions() {
    const langs = ['en', 'de', 'es', 'fr'];

    if (languageSelect) {
        const prev = languageSelect.value;
        languageSelect.innerHTML = '';
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
        else if (langs.includes('en')) languageSelect.value = 'en';
    }
}

if (languageSelect) {
    languageSelect.addEventListener('change', () => {
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

function splitTextIntoParagraphs(text) {
    const paragraphs = [];
    if (!text) return paragraphs;

    const separatorRegex = /\r?\n(?:\s*\r?\n)+/g;
    let lastIndex = 0;
    let match;

    while ((match = separatorRegex.exec(text)) !== null) {
        const endIndex = match.index;
        if (endIndex > lastIndex) {
            paragraphs.push({
                start: lastIndex,
                end: endIndex,
                text: text.slice(lastIndex, endIndex)
            });
        }
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        paragraphs.push({
            start: lastIndex,
            end: text.length,
            text: text.slice(lastIndex)
        });
    }

    if (!paragraphs.length && text.length) {
        paragraphs.push({start: 0, end: text.length, text});
    }

    return paragraphs;
}

function findParagraphIndexByChar(paragraphs, charIndex) {
    if (!paragraphs || !paragraphs.length) return -1;
    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        if (charIndex >= para.start && charIndex < para.end) {
            return i;
        }
    }
    return paragraphs.length - 1;
}

function wrapTextForHighlighting(text, chapterIdx = null) {
    currentParagraphChapterIdx = typeof chapterIdx === 'number' ? chapterIdx : null;
    currentParagraphs = splitTextIntoParagraphs(text);
    currentHighlightedParagraphIndex = null;

    if (!currentParagraphs.length) {
        return escapeHtml(text || '').replace(/\n/g, '<br/>');
    }

    return currentParagraphs.map((para, index) => {
        const displayText = escapeHtml(para.text.trim()).replace(/\n/g, '<br/>') || '&nbsp;';
        return `<div class="chapter-paragraph" data-paragraph-index="${index}" data-start="${para.start}" data-end="${para.end}">${displayText}</div>`;
    }).join('');
}

function clearTTSHighlights() {
    document.querySelectorAll('#chapter-text .chapter-paragraph.tts-highlight')
        .forEach(el => el.classList.remove('tts-highlight'));
    currentHighlightedParagraphIndex = null;
}

function highlightParagraphForCharIndex(charIndex) {
    if (!currentParagraphs.length || currentParagraphChapterIdx === null) return;
    const paragraphIdx = findParagraphIndexByChar(currentParagraphs, charIndex);
    if (paragraphIdx === -1 || paragraphIdx === currentHighlightedParagraphIndex) return;

    clearTTSHighlights();

    const paragraphEl = document.querySelector(`#chapter-text .chapter-paragraph[data-paragraph-index="${paragraphIdx}"]`);
    if (paragraphEl) {
        paragraphEl.classList.add('tts-highlight');
        currentHighlightedParagraphIndex = paragraphIdx;
    }
}

function normalizeStartCharToParagraph(paragraphs, startChar) {
    if (!paragraphs.length) return 0;
    if (startChar <= paragraphs[0].start) return paragraphs[0].start;
    const idx = findParagraphIndexByChar(paragraphs, startChar);
    if (idx === -1) return paragraphs[paragraphs.length - 1].start;
    return paragraphs[idx].start;
}

function buildParagraphChunksFromParagraphs(paragraphs, startIndex, fullText, minChars = 400) {
    if (!paragraphs.length) {
        const trimmed = (fullText || '').trim();
        if (!trimmed) return [];
        return [{
            text: trimmed,
            start: 0,
            end: fullText.length
        }];
    }

    const chunks = [];
    let index = startIndex < 0 ? 0 : Math.min(startIndex, paragraphs.length - 1);

    while (index < paragraphs.length) {
        let chunkStart = paragraphs[index].start;
        let chunkEnd = paragraphs[index].end;
        let lastParagraphIdx = index;

        while ((chunkEnd - chunkStart) < minChars && lastParagraphIdx + 1 < paragraphs.length) {
            lastParagraphIdx++;
            chunkEnd = paragraphs[lastParagraphIdx].end;
        }

        const slice = fullText.slice(chunkStart, chunkEnd).trim();
        if (slice) {
            chunks.push({
                text: slice,
                start: chunkStart,
                end: chunkEnd
            });
        }

        index = lastParagraphIdx + 1;
    }

    return chunks;
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
        if (isOpenAIPlaying()) {
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

    const selectedModel = (modelSelect && modelSelect.value) || 'gpt-5.1';
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
        cleanupOpenAIAudio();
        resetStory();
    }
});

// Reset Prompts button - reset system prompts to defaults
resetPromptsBtn.addEventListener('click', () => {
    logActivity('🔄 Reset Prompts button pressed');
    // Reset prompts to default values
    if (defaultOutlinePrompt && outlineSystemPromptInput) {
        outlineSystemPromptInput.value = defaultOutlinePrompt;
    }
    if (defaultChapterPrompt && chapterSystemPromptInput) {
        chapterSystemPromptInput.value = defaultChapterPrompt;
    }
    logActivity('✅ System prompts reset to defaults');
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
        // Use word wrapping for highlighting support
        const wrappedText = wrapTextForHighlighting(item.chapterText, idx);
        showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div id="chapter-text">${wrappedText}</div>`);
    } else {
        showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div class="placeholder">No chapter generated yet. Click "Generate Selected Chapter".</div><p class="small text-muted">${escapeHtml(item.description)}</p>`);
    }
}

if (chapterContainer) {
    chapterContainer.addEventListener('dblclick', async (event) => {
        const paragraphEl = event.target.closest('.chapter-paragraph');
        if (!paragraphEl) return;
        if (selectedIndex === null) return;
        const chapter = outline[selectedIndex];
        if (!chapter || !chapter.chapterText) return;

        const startChar = parseInt(paragraphEl.dataset.start || '0', 10) || 0;
        logActivity(`🎯 Starting playback from paragraph in chapter ${selectedIndex + 1} (char ${startChar})`);

        try {
            await requestWakeLock();
        } catch (e) {
        }

        playingIndex = selectedIndex;
        speakChapter(selectedIndex, startChar);
    });
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

if (generateWholeStoryBtn) {
    generateWholeStoryBtn.addEventListener('click', async () => {
        if (isGeneratingWholeStory) return;
        if (!outline.length) {
            alert('No outline available. Generate one first.');
            logActivity('❌ Generate whole story failed: No outline');
            return;
        }
        const chaptersToGenerate = outline
            .map((chapter, idx) => (!chapter || chapter.chapterText ? null : idx))
            .filter(idx => idx !== null);
        if (!chaptersToGenerate.length) {
            alert('All chapters are already generated.');
            logActivity('ℹ️ Generate whole story skipped: All chapters done');
            return;
        }

        logActivity('📚 Generate Whole Story button pressed');
        setWholeStoryGenerationState(true);
        showMessageInChapterContainer('<div class="d-flex align-items-center"><strong>Generating all chapters…</strong><div class="spinner-border ms-3" role="status" aria-hidden="true"></div></div>');

        try {
            for (const idx of chaptersToGenerate) {
                await generateChapter(idx, true, {serviceTierOverride: 'flex'});
            }
            logActivity('🎉 Whole story generation completed');
        } catch (err) {
            console.error('Whole story generation failed', err);
            logError('Whole story generation failed', err);
            showError('Whole story generation failed: ' + err.message);
        } finally {
            setWholeStoryGenerationState(false);
            if (selectedIndex !== null && outline[selectedIndex] && outline[selectedIndex].chapterText) {
                selectOutlineIndex(selectedIndex);
            }
        }
    });
}

async function generateChapter(idx, foreground = true, options = {}) {
    // If this exact chapter is already being generated, return the existing promise
    if (generatingChapterIndex === idx && chapterGenerationPromise) {
        logActivity(`⏳ Chapter ${idx + 1} generation already in progress, waiting...`);
        return chapterGenerationPromise;
    }

    if (isGenerating) {
        logActivity(`⚠️ Another chapter is being generated, please wait...`);
        return;
    }

    isGenerating = true;
    generatingChapterIndex = idx;
    updatePlayButtonState();

    // Create the generation promise
    chapterGenerationPromise = (async () => {
        let apiKey = getApiKey();
        if (!apiKey) {
            const entered = prompt('OpenAI API key not found. Please enter it:');
            if (entered) setApiKey(entered.trim());
            apiKey = getApiKey();
            if (!apiKey) {
                isGenerating = false;
                generatingChapterIndex = null;
                updatePlayButtonState();
                logError('Chapter generation cancelled: No API key');
                return;
            }
        }

        const item = outline[idx];
        if (!item) {
            isGenerating = false;
            generatingChapterIndex = null;
            updatePlayButtonState();
            logError(`Chapter generation failed: No item at index ${idx}`);
            return;
        }

        let systemPrompt = (chapterSystemPromptInput.value || '').trim();
        if (!systemPrompt) systemPrompt = 'You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.';

        const selectedModel = (modelSelect && modelSelect.value) || 'gpt-5.1';
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

            const serviceTier = Object.prototype.hasOwnProperty.call(options, 'serviceTierOverride')
                ? options.serviceTierOverride
                : (foreground ? null : 'flex');

            const resp = await window.StoryGenerator.generateChapter(
                apiKey,
                item,
                systemPrompt,
                priorChapters,
                storyPrompt,
                languageCode,
                bookMetadata,
                selectedModel,
                serviceTier
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
            generatingChapterIndex = null;
            chapterGenerationPromise = null;
            updatePlayButtonState();
        }
    })();

    return chapterGenerationPromise;
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

// Continue button - resume from saved reading position
continueBtn.addEventListener('click', async () => {
    logActivity('⏩ Continue button pressed');

    // Request wake lock before playing (best-effort)
    try {
        await requestWakeLock();
    } catch (e) {
        // ignore failures; playback should still proceed
    }

    // Load saved reading position
    const savedPosition = loadReadingPosition();

    if (savedPosition === null) {
        logActivity('⚠️ No saved reading position found, starting from beginning');
        // Fall back to Play button behavior
        playBtn.click();
        return;
    }

    // If there's no outline yet, generate it first
    if (!outline.length) {
        logActivity('📋 No outline found, generating...');
        try {
            await generateOutline(true);
        } catch (e) {
            updatePlayButtonState();
            return;
        }
        if (!outline.length) {
            updatePlayButtonState();
            return;
        }
    }

    // Validate saved position
    if (savedPosition.chapter >= outline.length) {
        logActivity(`⚠️ Saved position (chapter ${savedPosition.chapter + 1}) is beyond current outline, starting from beginning`);
        playingIndex = 0;
    } else {
        playingIndex = savedPosition.chapter;
        if (savedPosition.char > 0) {
            logActivity(`📖 Resuming from saved position: chapter ${playingIndex + 1}, character ${savedPosition.char}`);
        } else {
            logActivity(`📖 Resuming from saved position: chapter ${playingIndex + 1}`);
        }
    }

    // disable play immediately while generation/prepare starts
    playBtn.disabled = true;

    if (!outline[playingIndex] || !outline[playingIndex].chapterText) {
        logActivity(`📝 Chapter ${playingIndex + 1} not generated, generating now...`);
        try {
            await generateChapter(playingIndex, true);
        } catch (e) {
            updatePlayButtonState();
            return;
        }
    }

    speakChapter(playingIndex, savedPosition.char);
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
    if (openaiAudio) {
        if (openaiAudio.paused) openaiAudio.play();
        else openaiAudio.pause();
    }
});

stopBtn.addEventListener('click', async () => {
    logActivity('⏹️ Stop button pressed');
    // Clear any TTS highlights
    clearTTSHighlights();
    
    cleanupOpenAIAudio();
    playingIndex = null;
    // Release wake lock when stopping playback
    try {
        await releaseWakeLock();
    } catch (e) {
        // ignore
    }
    updatePlayButtonState();
});

// Copy whole story to clipboard
copyStoryBtn.addEventListener('click', async () => {
    logActivity('📋 Copy Whole Story button pressed');

    if (!outline.length) {
        alert('No story to copy. Generate an outline first.');
        logActivity('❌ Copy failed: No outline available');
        return;
    }

    // Build the complete story text
    let storyText = '';

    // Add title and metadata if available
    if (storyTitle) {
        storyText += `${storyTitle}\n`;
        if (storySubtitle) {
            storyText += `${storySubtitle}\n`;
        }
        storyText += '\n';
    }

    if (storyDescription) {
        storyText += `${storyDescription}\n\n`;
    }

    if (storyCharacters && storyCharacters.length) {
        storyText += 'Main Characters:\n';
        storyCharacters.forEach(char => {
            storyText += `• ${char.name}: ${char.description}\n`;
        });
        storyText += '\n';
    }

    storyText += '═'.repeat(60) + '\n\n';

    // Add all chapters
    let chaptersWithText = 0;
    outline.forEach((chapter, idx) => {
        storyText += `Chapter ${idx + 1}: ${chapter.title}\n\n`;
        if (chapter.chapterText) {
            storyText += `${chapter.chapterText}\n\n`;
            storyText += '─'.repeat(60) + '\n\n';
            chaptersWithText++;
        } else {
            storyText += `[Not yet generated]\n\n`;
            storyText += '─'.repeat(60) + '\n\n';
        }
    });

    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(storyText);
        logActivity(`✅ Story copied to clipboard (${chaptersWithText}/${outline.length} chapters generated)`);

        // Visual feedback
        const originalText = copyStoryBtn.textContent;
        copyStoryBtn.textContent = '✓ Copied!';
        copyStoryBtn.classList.add('btn-success');
        copyStoryBtn.classList.remove('btn-outline-secondary');

        setTimeout(() => {
            copyStoryBtn.textContent = originalText;
            copyStoryBtn.classList.remove('btn-success');
            copyStoryBtn.classList.add('btn-outline-secondary');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        logError('Failed to copy story to clipboard', err);
        alert('Failed to copy to clipboard. Please check browser permissions.');
    }
});

if (exportStoryBtn) {
    exportStoryBtn.addEventListener('click', async () => {
        logActivity('📤 Export Story Data button pressed');
        try {
            const payload = buildStoryExportPayload();
            const json = JSON.stringify(payload, null, 2);
            await navigator.clipboard.writeText(json);
            const chapters = payload.storyState && Array.isArray(payload.storyState.outline)
                ? payload.storyState.outline.length
                : 0;
            logActivity(`✅ Exported story data to clipboard (${chapters} outline entries)`);
        } catch (err) {
            logError('Failed to export story data', err);
            alert('Failed to copy the export JSON to the clipboard. Please check browser permissions.');
        }
    });
}

if (importStoryBtn) {
    importStoryBtn.addEventListener('click', () => {
        logActivity('📥 Import Story Data button pressed');
        const raw = prompt('Paste the JSON that was created by "Export Story Data":');
        if (!raw) {
            logActivity('ℹ️ Import cancelled: No data provided');
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            logError('Import failed: Invalid JSON input', err);
            alert('The provided text is not valid JSON. Please try again.');
            return;
        }

        try {
            applyImportedStoryData(parsed);
            logActivity('✅ Story data imported');
        } catch (err) {
            logError('Failed to apply imported story data', err);
            alert('The story data could not be imported. Check the log for details.');
        }
    });
}

function buildStoryExportPayload() {
    const settingsSnapshot = {
        autoplay: autoplayCheckbox ? autoplayCheckbox.checked : undefined,
        language: languageSelect ? languageSelect.value : undefined,
        outlineSystemPrompt: outlineSystemPromptInput ? outlineSystemPromptInput.value : undefined,
        chapterSystemPrompt: chapterSystemPromptInput ? chapterSystemPromptInput.value : undefined,
        storyPrompt: storyPromptInput ? storyPromptInput.value : undefined,
        model: modelSelect ? modelSelect.value : undefined,
        openaiVoice: openaiVoiceSelect ? openaiVoiceSelect.value : undefined,
        openaiInstructions: getCurrentVoiceInstructions(),
        openaiTTSModel: openaiTTSModelSelect ? openaiTTSModelSelect.value : undefined
    };

    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: settingsSnapshot,
        storyState: {
            outline: outline,
            storyTitle,
            storySubtitle,
            storyDescription,
            storyCharacters,
            selectedIndex
        },
        readingPosition: loadReadingPosition()
    };
}

function applyImportedStoryData(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Import payload must be an object');
    }

    const missingSettings = applyImportedSettings(payload.settings);

    const importedStory = payload.storyState;
    if (importedStory && Array.isArray(importedStory.outline)) {
        outline = importedStory.outline;
        storyTitle = importedStory.storyTitle || null;
        storySubtitle = importedStory.storySubtitle || null;
        storyDescription = importedStory.storyDescription || null;
        storyCharacters = importedStory.storyCharacters || null;
        selectedIndex = typeof importedStory.selectedIndex === 'number' ? importedStory.selectedIndex : null;

        if (selectedIndex !== null && !outline[selectedIndex]) {
            selectedIndex = null;
        }

        renderOutline();
        if (selectedIndex !== null) {
            selectOutlineIndex(selectedIndex);
        } else if (outline.length > 0) {
            showMessageInChapterContainer('<div class="placeholder">Story imported. Select a chapter to view or generate.</div>');
        } else {
            showMessageInChapterContainer('<div class="placeholder">Story imported but no outline entries found.</div>');
        }
        saveStoryState();
    } else {
        logActivity('⚠️ Imported data had no outline; keeping current story state');
    }

    const readingPosition = payload.readingPosition;
    if (readingPosition && typeof readingPosition.chapter === 'number') {
        saveReadingPosition(readingPosition.chapter, readingPosition.char || 0);
    } else if (readingPosition === null) {
        clearReadingPosition();
    }

    cleanupOpenAIAudio();
    playingIndex = null;
    updatePlayButtonState();

    if (missingSettings && missingSettings.length) {
        logActivity(`⚠️ Missing settings in import data: ${missingSettings.join(', ')}`);
    }
}

function applyImportedSettings(importedSettings) {
    if (!importedSettings || typeof importedSettings !== 'object') {
        logActivity('⚠️ Imported data missing settings; keeping current configuration');
        return [];
    }

    const expectedKeys = [
        'autoplay',
        'language',
        'outlineSystemPrompt',
        'chapterSystemPrompt',
        'storyPrompt',
        'model',
        'openaiVoice',
        'openaiInstructions',
        'openaiTTSModel'
    ];
    const missing = expectedKeys.filter(key => !(key in importedSettings));

    if ('autoplay' in importedSettings && autoplayCheckbox) {
        autoplayCheckbox.checked = !!importedSettings.autoplay;
    }
    if ('language' in importedSettings && languageSelect) {
        applySelectValueWithWarning(languageSelect, importedSettings.language, 'language');
    }
    if ('outlineSystemPrompt' in importedSettings && outlineSystemPromptInput) {
        outlineSystemPromptInput.value = importedSettings.outlineSystemPrompt || '';
    }
    if ('chapterSystemPrompt' in importedSettings && chapterSystemPromptInput) {
        chapterSystemPromptInput.value = importedSettings.chapterSystemPrompt || '';
    }
    if ('storyPrompt' in importedSettings && storyPromptInput) {
        storyPromptInput.value = importedSettings.storyPrompt || '';
        try {
            localStorage.setItem(STORY_PROMPT_STORAGE, storyPromptInput.value || '');
        } catch (e) {
        }
    }
    if ('model' in importedSettings && modelSelect) {
        applySelectValueWithWarning(modelSelect, importedSettings.model, 'model');
        try {
            localStorage.setItem(MODEL_STORAGE, modelSelect.value || '');
        } catch (e) {
        }
    }
    if ('openaiVoice' in importedSettings && openaiVoiceSelect) {
        applySelectValueWithWarning(openaiVoiceSelect, importedSettings.openaiVoice, 'voice');
        try {
            localStorage.setItem(OPENAI_VOICE_STORAGE, openaiVoiceSelect.value || '');
        } catch (e) {
        }
    }
    if ('openaiInstructions' in importedSettings) {
        if (openaiInstructionsTextarea) {
            openaiInstructionsTextarea.value = importedSettings.openaiInstructions || '';
        }
        if (openaiInstructionsSelect) {
            applySelectValueWithWarning(openaiInstructionsSelect, importedSettings.openaiInstructions, 'voice instructions');
        }
        try {
            localStorage.setItem(OPENAI_INSTRUCTIONS_STORAGE, importedSettings.openaiInstructions || '');
        } catch (e) {
        }
    }
    if ('openaiTTSModel' in importedSettings && openaiTTSModelSelect) {
        applySelectValueWithWarning(openaiTTSModelSelect, importedSettings.openaiTTSModel, 'TTS model');
        try {
            localStorage.setItem(OPENAI_TTS_MODEL_STORAGE, openaiTTSModelSelect.value || '');
        } catch (e) {
        }
    }

    saveSettings();
    updateVoiceInstructionsUI();

    return missing;
}

function applySelectValueWithWarning(selectEl, value, label) {
    if (!selectEl) return;
    const targetValue = value === undefined || value === null ? '' : value;
    const exists = Array.from(selectEl.options).some(opt => opt.value === targetValue);
    if (!exists) {
        logActivity(`⚠️ Imported ${label} "${targetValue}" is not available; keeping current selection`);
        return;
    }
    selectEl.value = targetValue;
}

function speakChapter(idx, startChar = 0) {
    return speakChapterWithOpenAI(idx, startChar);
}

async function speakChapterWithOpenAI(idx, startChar = 0) {
    const item = outline[idx];
    if (!item || !item.chapterText) return;

    cleanupOpenAIAudio();
    selectOutlineIndex(idx);

    let normalizedStart = startChar;
    if (startChar > 0 && startChar < item.chapterText.length) {
        logActivity(`🔊 Speaking chapter ${idx + 1} with OpenAI TTS from character ${startChar}: "${item.title}"`);
    } else {
        normalizedStart = 0;
        logActivity(`🔊 Speaking chapter ${idx + 1} with OpenAI TTS: "${item.title}"`);
    }

    const paragraphs = splitTextIntoParagraphs(item.chapterText);
    const paragraphStart = normalizeStartCharToParagraph(paragraphs, normalizedStart);
    if (paragraphStart !== normalizedStart) {
        logActivity(`ℹ️ Adjusted start to paragraph boundary at character ${paragraphStart}`);
    }
    normalizedStart = paragraphStart;

    saveReadingPosition(idx, normalizedStart);

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
    const instructions = getCurrentVoiceInstructions();
    const ttsModel = (openaiTTSModelSelect && openaiTTSModelSelect.value) || 'tts-1-hd';

    try {
        const startParagraphIdx = findParagraphIndexByChar(paragraphs, normalizedStart);
        const paragraphChunks = buildParagraphChunksFromParagraphs(paragraphs, startParagraphIdx, item.chapterText);

        if (!paragraphChunks.length) {
            logError('OpenAI TTS failed: No readable text', new Error('Empty chapter text'));
            showError('No chapter text available for playback.');
            updatePlayButtonState();
            return;
        }

        if (paragraphChunks.length > 1) {
            logActivity(`📄 Chapter ${idx + 1} split into ${paragraphChunks.length} paragraph chunks for OpenAI TTS`);
        } else {
            logActivity(`📄 Chapter ${idx + 1} will be spoken in a single paragraph chunk`);
        }

        await playOpenAIChunks(idx, paragraphChunks, voice, instructions, ttsModel, key);

    } catch (err) {
        console.error('OpenAI TTS error', err);
        logError('OpenAI TTS failed', err);
        showError('Failed to fetch/play OpenAI audio: ' + (err && err.message ? err.message : String(err)));
        updatePlayButtonState();
    }
}

async function playOpenAIChunks(chapterIdx, chunks, voice, instructions, model, key) {
    if (!chunks.length) return;

    const item = outline[chapterIdx];
    if (item && item.chapterText) {
        const wrappedText = wrapTextForHighlighting(item.chapterText, chapterIdx);
        showMessageInChapterContainer(`<h4>${escapeHtml(item.title)}</h4><div id="chapter-text">${wrappedText}</div>`);
    }

    let nextChunkPromise = null;
    if (chunks.length > 0) {
        const chunkLabel = chunks.length > 1 ? `chunk 1/${chunks.length}` : 'audio';
        logActivity(`🔊 Fetching ${chunkLabel} for chapter ${chapterIdx + 1}`);
        nextChunkPromise = fetchOpenAITTS(chunks[0].text, voice, instructions, model, key);
    }

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLastChunk = (i === chunks.length - 1);
        const chunkLength = Math.max(1, chunk.end - chunk.start);

        const buffer = await nextChunkPromise;
        if (!buffer) {
            throw new Error('No audio returned from OpenAI');
        }

        if (!isLastChunk) {
            const nextChunkIdx = i + 1;
            logActivity(`🔄 Pre-fetching chunk ${nextChunkIdx + 1}/${chunks.length} in background`);
            nextChunkPromise = fetchOpenAITTS(chunks[nextChunkIdx].text, voice, instructions, model, key);
        }

        if (chunks.length > 1) {
            logActivity(`🔊 Playing chunk ${i + 1}/${chunks.length} of chapter ${chapterIdx + 1}`);
        }

        const blob = new Blob([buffer], {type: 'audio/mpeg'});
        cleanupOpenAIAudio();
        openaiAudioUrl = URL.createObjectURL(blob);
        openaiAudio = new Audio(openaiAudioUrl);
        openaiAudio.crossOrigin = 'anonymous';

        saveReadingPosition(chapterIdx, chunk.start);
        highlightParagraphForCharIndex(chunk.start);

        let lastSaveTime = 0;
        openaiAudio.ontimeupdate = () => {
            if (openaiAudio && openaiAudio.duration > 0) {
                const progress = openaiAudio.currentTime / openaiAudio.duration;
                const charsIntoChunk = Math.floor(chunkLength * progress);
                const absoluteCharIndex = chunk.start + charsIntoChunk;
                highlightParagraphForCharIndex(absoluteCharIndex);

                const now = Date.now();
                if (now - lastSaveTime > 10000) {
                    saveReadingPosition(chapterIdx, absoluteCharIndex);
                    lastSaveTime = now;
                }
            }
        };

        openaiAudio.onplay = () => updatePlayButtonState();
        openaiAudio.onpause = () => updatePlayButtonState();
        openaiAudio.onerror = (e) => {
            logError(`OpenAI audio playback error on chapter ${chapterIdx + 1}, chunk ${i + 1}`, e);
            console.error('OpenAI audio playback error', e);
        };

        // Wait for this chunk to finish
        await new Promise((resolve, reject) => {
            openaiAudio.onended = () => {
                if (isLastChunk) {
                    // Clear highlights when chapter finishes
                    clearTTSHighlights();
                    
                    // This was the last chunk of the chapter
                    logActivity(`✅ Finished speaking chapter ${chapterIdx + 1}: "${outline[chapterIdx].title}"`);
                    playingIndex = chapterIdx + 1;
                    updatePlayButtonState();

                    if (playingIndex < outline.length) {
                        if (autoplayCheckbox && !autoplayCheckbox.checked) {
                            logActivity(`⏸️ Autoplay disabled, stopping at chapter ${playingIndex}`);
                            resolve();
                            return;
                        }
                        if (outline[playingIndex].chapterText) {
                            setTimeout(() => {
                                speakChapter(playingIndex).then(resolve).catch(reject);
                            }, 200);
                        } else {
                            logActivity(`⏳ Waiting for chapter ${playingIndex + 1} to be generated...`);
                            generateChapter(playingIndex, true).then(() => {
                                logActivity(`▶️ Continuing autoplay with chapter ${playingIndex + 1}`);
                                speakChapter(playingIndex).then(resolve).catch(reject);
                            }).catch(err => {
                                logError(`Failed to generate chapter ${playingIndex + 1} for autoplay`, err);
                                reject(err);
                            });
                        }
                    } else {
                        logActivity(`🎉 All chapters completed!`);
                        try { releaseWakeLock(); } catch (e) {}
                        playingIndex = null;
                        resolve();
                    }
                } else {
                    // Move to next chunk
                    resolve();
                }
            };

            openaiAudio.onerror = (e) => {
                reject(e);
            };

            // Start playback
            updatePlayButtonState();
            openaiAudio.play().catch(reject);
        });

    }
}

async function fetchOpenAITTS(text, voice, instructions, model, apiKey) {
    // Call OpenAI TTS endpoint - return ArrayBuffer of audio (MP3)
    const payload = {
        model: model || 'tts-1-hd',
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
