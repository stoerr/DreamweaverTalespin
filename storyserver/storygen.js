const fs = require('fs');
const path = require('path');
const {callChatCompletions, textToSpeech, generateImage} = require('./openai');
const {spawn} = require('child_process');
const {PassThrough} = require('stream');

const DEFAULT_CHAT_MODEL = 'gpt-5.1';
const DEFAULT_TEMPERATURE = 1;
const DEFAULT_TTS_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const STORIES_DIR = path.resolve(process.cwd(), 'stories');

const OUTLINE_PROMPT_FALLBACK = 'You are an assistant that creates a story outline as JSON with the following structure:\n\n- A title for the book\n- A subtitle for the book\n- A short description of the book (2-3 sentences)\n- A list of main characters with their names and one paragraph descriptions of their main traits\n- A numbered list of chapters, each with a title, short description, and a one paragraph detailed description\n\nYou will specialize in creating and narrating good night stories in the style of the users favorite authors in immersive\nnarration style. If the user doesn\'t specify an author, it should use my favorite authors Terry Pratchett, Douglas\nAdams, William Gibson, T. Kingfisher, Stanislaw Lem, Jasper Fforde.\n\nEach part of the story should be rich with detailed backstories, vivid descriptions, engaging dialogues, and detailed\ncharacter interactions. Focus on creating immersive scenes that bring the narrative to life. Dive deep into the\nthoughts, emotions, and conversations of the characters, providing a window into their experiences. Set each scene with\nprecise environmental details, making the reader feel present in the moment. The story should unfold through a series of\nwell-developed episodes, each filled with its own mini-narrative that contributes to the overall journey. Tell the plot\nstep by step as it unfolds for the main characters.';

const CHAPTER_PROMPT_FALLBACK = 'You are an assistant that expands a chapter description into a full chapter. Keep it vivid and engaging.\n\nExpand the provided chapter title and short description into a coherent chapter of several paragraphs, with sensory\ndetails, character actions, and dialogue where appropriate. Keep the tone consistent with the story idea and avoid\nintroducing unrelated subplots. Just output the text of the chapter.\n\nYou will specialize in creating and narrating good night stories in the style of the users favorite authors in immersive\nnarration style. If the user doesn\'t specify an author, it should use Terry Pratchett, Douglas Adams, William Gibson, T.\nKingfisher, Stanislaw Lem, Jasper Fforde.\n\nEach part of the story should be rich with detailed backstories, vivid descriptions, engaging dialogues, and detailed\ncharacter interactions. Focus on creating immersive scenes that bring the narrative to life. Dive deep into the\nthoughts, emotions, and conversations of the characters, providing a window into their experiences. Set each scene with\nprecise environmental details, making the reader feel present in the moment. The story should unfold through a series of\nwell-developed episodes, each filled with its own mini-narrative that contributes to the overall journey. Tell the plot\nstep by step as it unfolds for the main characters.';

function loadPrompt(filename, fallbackText) {
    const p = path.resolve(__dirname, '..', 'docs', 'prompts', filename);
    try {
        return fs.readFileSync(p, 'utf8');
    } catch (e) {
        return fallbackText;
    }
}

const DEFAULT_OUTLINE_PROMPT = loadPrompt('outline.md', OUTLINE_PROMPT_FALLBACK);
const DEFAULT_CHAPTER_PROMPT = loadPrompt('chapter.md', CHAPTER_PROMPT_FALLBACK);

function ts() {
    return new Date().toISOString().split('.')[0];
}

function logInfo(msg) {
    console.error(ts() + ' INFO ' + msg);
}

function logError(msg, err) {
    console.error(ts() + ' ERROR ' + msg + (err ? (' :: ' + err.message || err) : ''));
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function getLanguageInstruction(languageCode) {
    if (!languageCode) return '';
    const map = {en: 'English', de: 'German', fr: 'French', es: 'Spanish'};
    const name = map[languageCode] || languageCode;
    return 'Respond in ' + name + ' (' + languageCode + ').';
}

function parseOutline(text) {
    try {
        const json = JSON.parse(text);
        if (json && json.chapters && Array.isArray(json.chapters)) {
            const entries = json.chapters.map(function (ch) {
                return {
                    chaptertitle: ch.chaptertitle || ch.title || 'Untitled',
                    chaptershortdescription: ch.chaptershortdescription || ch.description || '',
                    chapterdetails: ch.chapterdetails || ''
                };
            });
            return {
                title: json.title || null,
                subtitle: json.subtitle || null,
                description: json.description || null,
                characters: json.characters || null,
                chapters: entries
            };
        }
    } catch (e) {
        // ignore and fall back
    }

    const lines = (text || '').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    const entries = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var match = line.match(/^\s*(\d+)\s*[.)]?\s*(.*)$/);
        var rest = match ? match[2] : line;
        var title = rest;
        var description = '';
        var sepMatch = rest.match(/^(.*?)\s*[-—:|]\s*(.*)$/);
        if (sepMatch) {
            title = sepMatch[1].trim();
            description = sepMatch[2].trim();
        }
        entries.push({chaptertitle: title, chaptershortdescription: description, chapterdetails: ''});
    }
    return {
        title: null,
        subtitle: null,
        description: null,
        characters: null,
        chapters: entries
    };
}

function pathForStory(baseDir, slug) {
    const storyDir = path.join(baseDir, slug);
    const chaptersDir = path.join(storyDir, 'chapters');
    const audioDir = path.join(storyDir, 'audio');
    return {
        base: storyDir,
        config: path.join(storyDir, 'config.json'),
        outline: path.join(storyDir, 'outline.json'),
        feed: path.join(storyDir, 'feed.rss'),
        cover: path.join(storyDir, 'cover.jpg'),
        chaptersDir: chaptersDir,
        audioDir: audioDir,
        chapterFile: function (index) {
            const name = String(index).padStart(3, '0') + '.md';
            return path.join(chaptersDir, name);
        },
        audioFile: function (index) {
            const name = String(index).padStart(3, '0') + '.mp3';
            return path.join(audioDir, name);
        },
        zipFile: path.join(audioDir, slug + '.zip'),
        playlistFile: path.join(audioDir, slug + '.m3u')
    };
}

function fileExists(file) {
    return fs.promises.access(file, fs.constants.F_OK).then(function () { return true; }, function () { return false; });
}

async function readJsonFile(file) {
    const data = await fs.promises.readFile(file, 'utf8');
    return JSON.parse(data);
}

async function writeFileAtomic(target, content, encoding) {
    const tmp = target + '.tmp';
    await fs.promises.writeFile(tmp, content, encoding);
    await fs.promises.rename(tmp, target);
}

const activeLocks = new Set();
function acquireLock(key) {
    if (activeLocks.has(key)) return false;
    activeLocks.add(key);
    return true;
}
function releaseLock(key) {
    activeLocks.delete(key);
}

function buildOutlineResponse(bodyText) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'application/json'},
        body: bodyText
    };
}

function buildMarkdownResponse(text) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'text/markdown'},
        body: text
    };
}

function buildAudioResponse(buffer) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'audio/mpeg'},
        body: buffer
    };
}

function buildZipResponse(stream) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'application/zip'},
        bodyStream: stream
    };
}

function buildFeedResponse(text) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'application/rss+xml'},
        body: text
    };
}

function buildHtmlResponse(text) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'text/html; charset=utf-8'},
        body: text
    };
}

function buildImageResponse(buffer) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'image/jpeg'},
        body: buffer
    };
}

function buildPlaylistResponse(text) {
    return {
        statusCode: 200,
        headers: {'Content-Type': 'audio/x-mpegurl'},
        body: text
    };
}

function buildGenerating(resource, chapter) {
    const status = {status: 'generating', resource: resource};
    if (chapter) status.chapter = chapter;
    return {
        statusCode: 202,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(status)
    };
}

function buildMissing() {
    return {statusCode: 404, headers: {'Content-Type': 'text/plain'}, body: 'Not found'};
}

function buildConflict(msg) {
    return {statusCode: 409, headers: {'Content-Type': 'text/plain'}, body: msg || 'Conflict'};
}

function buildCreated(body) {
    return {statusCode: 201, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {status: 'created'})};
}

function normalizeStoryConfig(raw, serverConfig) {
    const config = raw || {};
    return {
        title: config.title,
        author: config.author || config.creator || null,
        language: config.language || config.lang || null,
        storyIdea: config.storyIdea || config.storyPrompt || config.prompt || '',
        model: config.model || config.chatModel || serverConfig.chatModel || DEFAULT_CHAT_MODEL,
        temperature: config.temperature !== undefined ? config.temperature : (serverConfig.temperature !== undefined ? serverConfig.temperature : DEFAULT_TEMPERATURE),
        outlinePrompt: config.outlinePrompt || serverConfig.outlinePrompt || DEFAULT_OUTLINE_PROMPT,
        chapterPrompt: config.chapterPrompt || serverConfig.chapterPrompt || DEFAULT_CHAPTER_PROMPT,
        ttsModel: config.ttsModel || serverConfig.ttsModel || DEFAULT_TTS_MODEL,
        voice: config.voice || serverConfig.voice || DEFAULT_VOICE,
        ttsInstructions: config.ttsInstructions || '',
        serviceTier: config.serviceTier || config.service_tier || serverConfig.serviceTier || null,
        maxTokens: config.maxTokens || config.max_completion_tokens || null
    };
}

async function generateOutline(storyConfig) {
    const messages = [];
    const langInstr = getLanguageInstruction(storyConfig.language);

    messages.push({role: 'system', content: storyConfig.outlinePrompt + '\n\n' + langInstr});
    messages.push({role: 'user', content: storyConfig.storyIdea});

    const responseFormat = {
        type: 'json_schema',
        json_schema: {
            name: 'story_outline',
            strict: true,
            schema: {
                type: 'object',
                properties: {
                    title: {type: 'string'},
                    subtitle: {type: 'string'},
                    description: {type: 'string'},
                    characters: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            properties: {
                                name: {type: 'string'},
                                description: {type: 'string'}
                            },
                            required: ['name', 'description'],
                            additionalProperties: false
                        }
                    },
                    chapters: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            properties: {
                                chaptertitle: {type: 'string'},
                                chaptershortdescription: {type: 'string'},
                                chapterdetails: {type: 'string'}
                            },
                            required: ['chaptertitle', 'chaptershortdescription', 'chapterdetails'],
                            additionalProperties: false
                        }
                    }
                },
                required: ['title', 'subtitle', 'description', 'characters', 'chapters'],
                additionalProperties: false
            }
        }
    };

    const text = await callChatCompletions(messages, {
        response_format: responseFormat,
        model: storyConfig.model,
        temperature: storyConfig.temperature,
        maxTokens: storyConfig.maxTokens,
        service_tier: storyConfig.serviceTier
    }).catch(async function (err) {
        // fallback without response_format if API rejects it
        logError('Outline generation failed with response_format, retrying without it', err);
        return callChatCompletions(messages, {
            model: storyConfig.model,
            temperature: storyConfig.temperature,
            maxTokens: storyConfig.maxTokens,
            service_tier: storyConfig.serviceTier
        });
    });
    const parsed = parseOutline(text);
    parsed.language = storyConfig.language || null;
    parsed.storyIdea = storyConfig.storyIdea;
    parsed.model = storyConfig.model;
    parsed.outlinePrompt = storyConfig.outlinePrompt;
    parsed.chapterPrompt = storyConfig.chapterPrompt;
    parsed.generatedAt = new Date().toISOString();
    return parsed;
}

async function generateChapterText(index, outline, storyConfig) {
    const chapterInfo = outline.chapters[index - 1];
    const langInstr = getLanguageInstruction(storyConfig.language);
    const messages = [];

    var contextInfo = '';
    if (outline.title || outline.subtitle || outline.description || outline.characters) {
        const meta = {
            title: outline.title,
            subtitle: outline.subtitle,
            description: outline.description,
            characters: outline.characters
        };
        contextInfo += '\n\nBook context:\n```json\n' + JSON.stringify(meta, null, 2) + '\n```';
    }
    contextInfo += '\n\nThe story prompt is: ' + storyConfig.storyIdea;

    messages.push({
        role: 'system',
        content: storyConfig.chapterPrompt + '\n\n' + langInstr + contextInfo
    });

    const priorChapters = [];
    for (var i = 0; i < index - 1; i++) {
        const info = outline.chapters[i];
        const prior = {title: info.chaptertitle || info.title || 'Chapter ' + (i + 1), description: info.chaptershortdescription || info.description || ''};
        const chapterPath = pathForStory(storyConfig.storiesDir || STORIES_DIR, storyConfig.slug).chapterFile(i + 1);
        const exists = await fileExists(chapterPath);
        if (exists) {
            prior.chapterText = await fs.promises.readFile(chapterPath, 'utf8');
        }
        priorChapters.push(prior);
    }

    for (var j = 0; j < priorChapters.length; j++) {
        const prev = priorChapters[j];
        messages.push({role: 'user', content: 'Chapter: ' + prev.title + '\nDescription: ' + prev.description});
        if (prev.chapterText) messages.push({role: 'assistant', content: prev.chapterText});
    }

    var userContent = 'Chapter: ' + (chapterInfo.chaptertitle || chapterInfo.title || ('Chapter ' + index)) + '\nDescription: ' + (chapterInfo.chaptershortdescription || chapterInfo.description || '');
    if (chapterInfo.chapterdetails) {
        userContent += '\nDetails: ' + chapterInfo.chapterdetails;
    }
    messages.push({role: 'user', content: userContent});

    const response = await callChatCompletions(messages, {
        model: storyConfig.model,
        temperature: storyConfig.temperature,
        maxTokens: storyConfig.maxTokens,
        service_tier: storyConfig.serviceTier
    });
    return (response || '').trim();
}

function chapterMarkdown(title, body, shortDescription) {
    var header = '# ' + title;
    if (shortDescription) header += '\n\n' + shortDescription;
    return header + '\n\n' + body + '\n';
}

function xmlEscape(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildFeed(slug, outline, baseUrl, enclosureLengths) {
    const title = outline.title || ('Story ' + slug);
    const description = outline.description || outline.subtitle || outline.storyIdea || '';
    const base = (baseUrl || '').replace(/\/+$/, '');
    const feedLink = base + '/stories/' + slug + '/feed.rss';
    const items = outline.chapters.map(function (chapter, i) {
        const idx = i + 1;
        const padded = String(idx).padStart(3, '0');
        const chTitle = chapter.chaptertitle || chapter.title || ('Chapter ' + idx);
        const desc = chapter.chaptershortdescription || chapter.chapterdetails || '';
        const mdLink = base + '/stories/' + slug + '/chapters/' + idx + '.md';
        const audioLink = base + '/stories/' + slug + '/chapters/' + padded + '.mp3';
        const length = enclosureLengths && enclosureLengths[i] ? enclosureLengths[i] : 0;
        return [
            '  <item>',
            '    <title>' + xmlEscape(chTitle) + '</title>',
            '    <description><![CDATA[' + (desc || '') + ']]></description>',
            '    <link>' + xmlEscape(audioLink) + '</link>',
            '    <guid isPermaLink="false">' + xmlEscape(slug + '-chapter-' + idx) + '</guid>',
            '    <enclosure url="' + xmlEscape(audioLink) + '" length="' + String(length) + '" type="audio/mpeg" />',
            '    <comments>' + xmlEscape(mdLink) + '</comments>',
            '  </item>'
        ].join('\n');
    }).join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        '<channel>',
        '  <title>' + xmlEscape(title) + '</title>',
        '  <description>' + xmlEscape(description) + '</description>',
        '  <link>' + xmlEscape(feedLink) + '</link>',
        '  <atom:link href="' + xmlEscape(feedLink) + '" rel="self" type="application/rss+xml" />',
        '  <language>' + xmlEscape(outline.language || '') + '</language>',
        items,
        '</channel>',
        '</rss>',
        ''
    ].join('\n');
}

async function collectEnclosureLengths(outline, paths) {
    const lengths = [];
    if (!outline || !outline.chapters) return lengths;
    for (var i = 0; i < outline.chapters.length; i++) {
        const audioPath = paths.audioFile(i + 1);
        try {
            const stat = await fs.promises.stat(audioPath);
            lengths.push(stat.size);
        } catch (e) {
            lengths.push(0);
        }
    }
    return lengths;
}

function chunkTextForTts(text, limit) {
    const maxLen = limit || 4000;
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let current = '';
    function pushCurrent() {
        if (current.trim()) chunks.push(current.trim());
        current = '';
    }
    for (var i = 0; i < paragraphs.length; i++) {
        var p = paragraphs[i].trim();
        if (!p) continue;
        if (p.length > maxLen) {
            // split large paragraph by sentences
            var sentences = p.split(/(?<=[.!?])\s+/);
            for (var s = 0; s < sentences.length; s++) {
                var sentence = sentences[s];
                if ((current + ' ' + sentence).trim().length > maxLen) {
                    pushCurrent();
                    current = sentence;
                } else {
                    current = (current ? current + ' ' : '') + sentence;
                }
            }
            continue;
        }
        if ((current + '\n\n' + p).trim().length > maxLen) {
            pushCurrent();
        }
        current = current ? current + '\n\n' + p : p;
    }
    pushCurrent();
    return chunks;
}

async function loadStoryConfig(paths) {
    const exists = await fileExists(paths.config);
    if (!exists) return null;
    const raw = await readJsonFile(paths.config);
    return raw;
}

async function loadOutline(paths) {
    const exists = await fileExists(paths.outline);
    if (!exists) return null;
    const raw = await readJsonFile(paths.outline);
    return raw;
}

async function ensureDir(dir) {
    await fs.promises.mkdir(dir, {recursive: true});
}

async function ensureOutline(slug, paths, storyConfig) {
    const hasOutline = await fileExists(paths.outline);
    if (hasOutline) {
        const content = await fs.promises.readFile(paths.outline, 'utf8');
        return {status: 'ready', outline: JSON.parse(content), content: content};
    }

    const key = 'outline:' + slug;
    const locked = acquireLock(key);
    if (!locked) return {status: 'pending'};

    try {
        await ensureDir(paths.base);
        logInfo('Generating outline for story ' + slug);
        const generated = await generateOutline(storyConfig);
        const body = JSON.stringify(generated, null, 2);
        await writeFileAtomic(paths.outline, body, 'utf8');
        setImmediate(function () {
            ensureCover(slug, paths, storyConfig, generated).catch(function (e) {
                logError('Background cover generation failed for story ' + slug, e);
            });
        });
        logInfo('Finished outline for story ' + slug);
        return {status: 'ready', outline: generated, content: body};
    } catch (e) {
        logError('Failed generating outline for story ' + slug, e);
        throw e;
    } finally {
        releaseLock(key);
    }
}

async function ensureChapter(index, slug, paths, outline, storyConfig) {
    const file = paths.chapterFile(index);
    const exists = await fileExists(file);
    if (exists) return {status: 'ready'};

    await ensureDir(paths.chaptersDir);
    const key = 'chapter:' + slug + ':' + index;
    let locked = acquireLock(key);
    if (!locked) {
        // wait for in-flight chapter generation to finish
        while (!locked) {
            const fileNow = await fileExists(file);
            if (fileNow) return {status: 'ready'};
            await sleep(200);
            locked = acquireLock(key);
        }
    }

    try {
        logInfo('Generating chapter ' + index + ' for story ' + slug);
        const text = await generateChapterText(index, outline, storyConfig);
        const title = outline.chapters[index - 1].chaptertitle || ('Chapter ' + index);
        const md = chapterMarkdown(title, text, outline.chapters[index - 1].chaptershortdescription);
        await writeFileAtomic(file, md, 'utf8');
        logInfo('Finished chapter ' + index + ' for story ' + slug);
        return {status: 'ready'};
    } catch (e) {
        logError('Failed generating chapter ' + index + ' for story ' + slug, e);
        throw e;
    } finally {
        releaseLock(key);
    }
}

async function ensureChaptersThrough(n, slug, paths, outline, storyConfig) {
    for (var i = 1; i <= n; i++) {
        const status = await ensureChapter(i, slug, paths, outline, storyConfig);
        if (status.status === 'pending') return status;
    }
    return {status: 'ready'};
}

async function ensureAudio(index, slug, paths, storyConfig) {
    const audioFile = paths.audioFile(index);
    const exists = await fileExists(audioFile);
    if (exists) return {status: 'ready', buffer: await fs.promises.readFile(audioFile)};

    await ensureDir(paths.audioDir);
    const key = 'audio:' + slug + ':' + index;
    let locked = acquireLock(key);
    if (!locked) {
        // wait for in-flight audio generation to complete
        while (!locked) {
            const existsNow = await fileExists(audioFile);
            if (existsNow) return {status: 'ready', buffer: await fs.promises.readFile(audioFile)};
            await sleep(200);
            locked = acquireLock(key);
        }
    }

    try {
        await ensureDir(paths.audioDir);
        const coverRes = await ensureCover(slug, paths, storyConfig).catch(function () { return {status: 'error'}; });
        if (coverRes && coverRes.path) storyConfig.coverPath = coverRes.path;
        logInfo('Generating audio for chapter ' + index + ' of story ' + slug);
        const chapterText = await fs.promises.readFile(paths.chapterFile(index), 'utf8');
        const parts = chunkTextForTts(chapterText, 4000);
        const buffers = [];
        for (var i = 0; i < parts.length; i++) {
            const buf = await textToSpeech(parts[i], {model: storyConfig.ttsModel, voice: storyConfig.voice, instructions: storyConfig.ttsInstructions});
            buffers.push(buf);
        }
        const merged = Buffer.concat(buffers);
        await writeFileAtomic(audioFile, merged);
        await tagMp3(audioFile, index, storyConfig.title, storyConfig.author, storyConfig.coverPath);
        logInfo('Finished audio for chapter ' + index + ' of story ' + slug);
        return {status: 'ready', buffer: merged};
    } catch (e) {
        logError('Failed generating audio for chapter ' + index + ' of story ' + slug, e);
        throw e;
    } finally {
        releaseLock(key);
    }
}

async function ensureFeed(slug, paths, outline, baseUrl) {
    const exists = await fileExists(paths.feed);
    if (exists) {
        const text = await fs.promises.readFile(paths.feed, 'utf8');
        return {status: 'ready', text: text};
    }

    const key = 'feed:' + slug;
    const locked = acquireLock(key);
    if (!locked) return {status: 'pending'};

    try {
        logInfo('Generating feed for story ' + slug);
        const enclosureLengths = await collectEnclosureLengths(outline, paths);
        const feed = buildFeed(slug, outline, baseUrl, enclosureLengths);
        await writeFileAtomic(paths.feed, feed, 'utf8');
        logInfo('Finished feed for story ' + slug);
        return {status: 'ready', text: feed};
    } catch (e) {
        logError('Failed generating feed for story ' + slug, e);
        throw e;
    } finally {
        releaseLock(key);
    }
}

async function ensurePlaylist(slug, paths, outline) {
    const file = paths.playlistFile;
    const exists = await fileExists(file);
    if (exists) {
        const text = await fs.promises.readFile(file, 'utf8');
        return {status: 'ready', text: text};
    }

    const key = 'playlist:' + slug;
    const locked = acquireLock(key);
    if (!locked) return {status: 'pending'};

    try {
        await ensureDir(paths.audioDir);
        const lines = ['#EXTM3U'];
        if (outline && outline.chapters) {
            for (var i = 0; i < outline.chapters.length; i++) {
                var idx = i + 1;
                var chapter = outline.chapters[i];
                var title = chapter.chaptertitle || chapter.title || ('Chapter ' + idx);
                lines.push('#EXTINF:-1,' + title);
                lines.push(String(idx).padStart(3, '0') + '.mp3');
            }
        }
        const text = lines.join('\n') + '\n';
        await writeFileAtomic(file, text, 'utf8');
        return {status: 'ready', text: text};
    } catch (e) {
        throw e;
    } finally {
        releaseLock(key);
    }
}

function backgroundGenerateChapter(index, slug, paths, outline, storyConfig) {
    if (!outline || !outline.chapters || index > outline.chapters.length) return;
    setImmediate(function () {
        ensureChaptersThrough(index, slug, paths, outline, storyConfig).catch(function (e) {
            console.error('Background chapter generation failed for', slug, index, e);
        });
    });
}

function backgroundGenerateAudio(index, slug, paths, outline, storyConfig) {
    if (!outline || !outline.chapters || index > outline.chapters.length) return;
    setImmediate(function () {
        ensureChaptersThrough(index, slug, paths, outline, storyConfig)
            .then(function (status) {
                if (status.status === 'ready') {
                    return ensureAudio(index, slug, paths, storyConfig);
                }
            })
            .catch(function (e) {
                console.error('Background audio generation failed for', slug, index, e);
            });
    });
}

async function serveOutline(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    return buildOutlineResponse(outlineResult.content);
}

async function serveChapterMarkdown(slug, chapterIndex, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    const outline = outlineResult.outline;
    if (!outline.chapters || outline.chapters.length < chapterIndex) return buildMissing();

    const chaptersStatus = await ensureChaptersThrough(chapterIndex, slug, paths, outline, storyConfig);
    if (chaptersStatus.status === 'pending') return buildGenerating('chapter', chapterIndex);

    const text = await fs.promises.readFile(paths.chapterFile(chapterIndex), 'utf8');
    if (chapterIndex < outline.chapters.length) {
        backgroundGenerateChapter(chapterIndex + 1, slug, paths, outline, storyConfig);
    }
    return buildMarkdownResponse(text);
}

async function serveChapterAudio(slug, chapterIndex, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    const outline = outlineResult.outline;
    if (!outline.chapters || outline.chapters.length < chapterIndex) return buildMissing();

    let chaptersStatus = await ensureChaptersThrough(chapterIndex, slug, paths, outline, storyConfig);
    while (chaptersStatus.status === 'pending') {
        await sleep(200);
        chaptersStatus = await ensureChaptersThrough(chapterIndex, slug, paths, outline, storyConfig);
    }

    let audioStatus = await ensureAudio(chapterIndex, slug, paths, storyConfig);
    while (audioStatus.status === 'pending') {
        await sleep(200);
        audioStatus = await ensureAudio(chapterIndex, slug, paths, storyConfig);
    }
    if (chapterIndex < outline.chapters.length) {
        backgroundGenerateAudio(chapterIndex + 1, slug, paths, outline, storyConfig);
    }
    return buildAudioResponse(audioStatus.buffer);
}

async function ensureZip(slug, paths, outline, storyConfig) {
    const key = 'zip:' + slug;
    let locked = acquireLock(key);
    while (!locked) {
        await sleep(200);
        locked = acquireLock(key);
    }

    try {
        await ensureDir(paths.audioDir);
        // ensure all chapters and audio
        const total = outline && outline.chapters ? outline.chapters.length : 0;
        logInfo('Preparing zip for story ' + slug + ' (' + total + ' chapters)');
        for (var i = 1; i <= total; i++) {
            await ensureChaptersThrough(i, slug, paths, outline, storyConfig);
            await ensureAudio(i, slug, paths, storyConfig);
        }

        let playlistStatus = await ensurePlaylist(slug, paths, outline);
        while (playlistStatus.status === 'pending') {
            await sleep(200);
            playlistStatus = await ensurePlaylist(slug, paths, outline);
        }

        const filesToZip = [];
        for (var j = 1; j <= total; j++) {
            filesToZip.push(paths.audioFile(j));
        }
        filesToZip.push(paths.playlistFile);
        const passthrough = new PassThrough();
        const args = ['-j', '-', ...filesToZip];
        const proc = spawn('zip', args);
        let stderr = '';

        proc.stdout.pipe(passthrough);
        proc.stderr.on('data', function (data) { stderr += data.toString(); });
        proc.on('error', function (err) {
            passthrough.destroy(err);
            releaseLock(key);
        });
        proc.on('close', function (code) {
            if (code !== 0) {
                const msg = stderr ? (' :: ' + stderr.trim()) : '';
                passthrough.destroy(new Error('zip exited with code ' + code + msg));
            }
            logInfo('Finished zip for story ' + slug);
            releaseLock(key);
        });

        return {status: 'ready', stream: passthrough};
    } catch (e) {
        logError('Failed creating zip for story ' + slug, e);
        releaseLock(key);
        throw e;
    }
}

async function ensureCover(slug, paths, storyConfig, outline) {
    const exists = await fileExists(paths.cover);
    if (exists) return {status: 'ready', path: paths.cover};
    const key = 'cover:' + slug;
    const locked = acquireLock(key);
    if (!locked) return {status: 'pending'};
    try {
        await ensureDir(paths.base);
        if (!outline) throw new Error('Outline required for cover generation');
        const meta = [
            'Title: ' + (outline.title || storyConfig.title || slug),
            'Subtitle: ' + (outline.subtitle || ''),
            'Description: ' + (outline.description || ''),
            'Story idea: ' + (storyConfig.storyIdea || '')
        ].join('\n');
        const prompt = 'Book cover art, warm pastel colors, gentle illustration. Use the following story info:\n' + meta;
        logInfo('Generating cover for story ' + slug);
        const img = await generateImage(prompt, {model: 'dall-e-3', size: '1024x1024'});
        await writeFileAtomic(paths.cover, img);
        logInfo('Finished cover for story ' + slug);
        return {status: 'ready', path: paths.cover};
    } catch (e) {
        logError('Failed generating cover for story ' + slug, e);
        throw e;
    } finally {
        releaseLock(key);
    }
}

function tagMp3(filePath, chapterIndex, bookTitle, author, coverPath) {
    const title = bookTitle ? bookTitle + ' - Chapter ' + chapterIndex : 'Chapter ' + chapterIndex;
    const args = ['-t', title];
    if (bookTitle) args.push('-A', bookTitle);
    if (author) args.push('-a', author);
    if (coverPath) args.push('-j', coverPath);
    args.push(filePath);
    return new Promise(function (resolve) {
        const proc = spawn('id3v2', args);
        proc.on('exit', function () { resolve(); });
        proc.on('error', function () { resolve(); });
    });
}

async function serveZip(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    const outline = outlineResult.outline;
    const zipStatus = await ensureZip(slug, paths, outline, storyConfig);
    if (zipStatus.status === 'pending') return buildGenerating('zip');
    return buildZipResponse(zipStatus.stream);
}

async function serveCoverImage(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;
    const outline = await loadOutline(paths);
    const coverRes = await ensureCover(slug, paths, storyConfig, outline);
    if (coverRes.status === 'pending') return buildGenerating('cover');
    const buf = await fs.promises.readFile(paths.cover);
    return buildImageResponse(buf);
}

async function serveFeed(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    const outline = outlineResult.outline;
    const feedStatus = await ensureFeed(slug, paths, outline, serverConfig.baseUrl || '');
    if (feedStatus.status === 'pending') return buildGenerating('feed');
    return buildFeedResponse(feedStatus.text);
}

async function servePlaylist(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    storyConfig.slug = slug;
    storyConfig.storiesDir = baseDir;

    const outlineResult = await ensureOutline(slug, paths, storyConfig);
    if (outlineResult.status === 'pending') return buildGenerating('outline');
    const outline = outlineResult.outline;
    const playlistStatus = await ensurePlaylist(slug, paths, outline);
    if (playlistStatus.status === 'pending') return buildGenerating('playlist');
    return buildPlaylistResponse(playlistStatus.text);
}

function buildIndexHtml(slug, config, outline, hasCover) {
    var safeSlug = xmlEscape(slug);
    var chapterSection = '';
    if (outline && outline.chapters && outline.chapters.length) {
        var items = '';
        for (var i = 0; i < outline.chapters.length; i++) {
            var idx = i + 1;
            var chapter = outline.chapters[i];
            var padded = String(idx).padStart(3, '0');
            var title = chapter.chaptertitle || chapter.title || ('Chapter ' + idx);
            var desc = chapter.chaptershortdescription || chapter.chapterdetails || '';
            var mdLink = '/stories/' + slug + '/chapters/' + idx + '.md';
            var htmlLink = '/stories/' + slug + '/chapters/' + idx + '.html';
            var audioLink = '/stories/' + slug + '/chapters/' + padded + '.mp3';
            items += '<div class="p-3 mb-3 rounded shadow-sm" style="background-color:#f5f7fb;">' +
                '<div class="d-flex justify-content-between align-items-center mb-2">' +
                '<div><span class="badge bg-info text-dark me-2">Chapter ' + idx + '</span><strong>' + xmlEscape(title) + '</strong></div>' +
                '<div class="small text-muted">' + xmlEscape(desc) + '</div>' +
                '</div>' +
                '<div class="d-flex gap-2 flex-wrap">' +
                '<a class="btn btn-sm btn-outline-primary" href="' + xmlEscape(mdLink) + '">Markdown</a>' +
                '<a class="btn btn-sm btn-outline-success" href="' + xmlEscape(htmlLink) + '">Read as HTML</a>' +
                '<a class="btn btn-sm btn-outline-secondary" href="' + xmlEscape(audioLink) + '">Audio (mp3)</a>' +
                '</div>' +
                '</div>';
        }
        chapterSection = '<h3 class="mb-3">Chapters</h3>' + items;
    } else {
        chapterSection = '<div class="alert alert-warning">Outline not generated yet. Use the button below to start.</div>';
    }

    var outlineMeta = '';
    if (outline) {
        outlineMeta =
            '<div class="mb-3"><strong>Title:</strong> ' + xmlEscape(outline.title || config.title || '') + '</div>' +
            '<div class="mb-3"><strong>Subtitle:</strong> ' + xmlEscape(outline.subtitle || '') + '</div>' +
            '<div class="mb-3"><strong>Description:</strong><br>' + xmlEscape(outline.description || '') + '</div>';
    }

    var charactersHtml = '';
    if (outline && outline.characters && outline.characters.length) {
        var chars = '';
        for (var c = 0; c < outline.characters.length; c++) {
            var ch = outline.characters[c];
            chars += '<div class="p-2 mb-2 rounded" style="background-color:#f1f8ff;">' +
                '<strong>' + xmlEscape(ch.name) + ':</strong> ' + xmlEscape(ch.description) + '</div>';
        }
        charactersHtml = '<h4>Characters</h4>' + chars;
    }

    var storyIdea = xmlEscape(config.storyIdea || '');
    var language = xmlEscape(config.language || '');
    var hasOutline = !!outline;
    var outlineBtn = '';
    if (!hasOutline) {
        outlineBtn = '<button id="generate-btn" class="btn btn-primary btn-sm">Generate outline</button>';
    }

    var coverHtml = '';
    if (hasCover) {
        coverHtml = '<img src="/stories/' + safeSlug + '/cover.jpg" alt="Cover" class="img-fluid rounded shadow-sm float-md-end ms-md-3 mb-3" style="max-width:320px; min-width:200px;">';
    }

    return '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Story: ' + xmlEscape(config.title || slug) + '</title>' +
        '<link rel="alternate" type="application/rss+xml" title="RSS feed for ' + xmlEscape(config.title || slug) + '" href="/stories/' + safeSlug + '/feed.rss">' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">' +
        '<style>body{background:linear-gradient(135deg,#fdfbfb 0%,#ebedee 100%);} .card-soft{border:0;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.08);} .btn-pastel{background-color:#dbeafe;color:#1e3a8a;border:0;} .btn-pastel:hover{background-color:#bfdbfe;color:#1e3a8a;} </style>' +
        '</head><body>' +
        '<div class="container py-4">' +
        '<div class="card card-soft p-4 mb-4" style="background-color:#fffaf5;">' +
        '<div>' +
        coverHtml +
        '<h1 class="h3 mb-3">' + xmlEscape(config.title || 'Story') + '</h1>' +
        '<p class="text-muted mb-1"><strong>Language:</strong> ' + language + '</p>' +
        '<p class="text-muted"><strong>Story idea:</strong> ' + storyIdea + '</p>' +
        '<div class="d-flex gap-2 flex-wrap mt-2">' +
        '<a class="btn btn-pastel" target="_blank" href="/stories/' + safeSlug + '/outline.json">Outline JSON</a>' +
        '<a class="btn btn-pastel" target="_blank" href="/stories/' + safeSlug + '/feed.rss">Feed</a>' +
        '<a class="btn btn-pastel" target="_blank" href="/stories/' + safeSlug + '/audio/' + safeSlug + '.m3u">Playlist (m3u)</a>' +
        '<a class="btn btn-pastel" target="_blank" href="/stories/' + safeSlug + '/audio/' + safeSlug + '.zip">Download all (zip)</a>' +
        '</div>' +
        '<div class="clearfix"></div>' +
        '</div>' +
        '</div>' +
        '<div class="card card-soft p-4 mb-4" style="background-color:#f6ffed;">' +
        '<div class="d-flex justify-content-between align-items-center mb-3"><h3 class="h5 mb-0">Outline</h3>' +
        outlineBtn +
        '</div>' +
        '<div id="status" class="text-muted small mb-3"></div>' +
        outlineMeta +
        charactersHtml +
        '</div>' +
        '<div class="card card-soft p-4" style="background-color:#fff;">' +
        chapterSection +
        '</div>' +
        '</div>' +
        '<script>' +
        '(function(){' +
        'var slug="' + safeSlug + '";' +
        'var btn=document.getElementById("generate-btn");' +
        'var statusEl=document.getElementById("status");' +
        'function setStatus(msg,cls){statusEl.textContent=msg;statusEl.className="mb-3 "+(cls||"text-muted small");}' +
        'function poll(){setStatus("Generating outline...","text-info");fetch("/stories/"+slug+"/outline.json").then(function(r){if(r.status===200){r.json().then(function(){location.reload();});return;}if(r.status===202){setTimeout(poll,1500);return;}setStatus("Failed: "+r.status+" "+r.statusText,"text-danger");}).catch(function(e){setStatus("Error: "+e.message,"text-danger");});}' +
        'if(btn){btn.addEventListener("click",function(){poll();});}' +
        '})();' +
        '</script>' +
        '</body></html>';
}

function buildChapterHtml(slug, chapterIndex) {
    var safeSlug = xmlEscape(slug);
    var idx = chapterIndex;
    var prev = idx > 1 ? '<a class="btn btn-outline-primary me-2" href="/stories/' + safeSlug + '/chapters/' + (idx - 1) + '.html">&laquo; Previous</a>' : '';
    var next = '<a class="btn btn-outline-primary" id="next-link" href="#">Next &raquo;</a>';

    return '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Chapter ' + idx + '</title>' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">' +
        '<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>' +
        '<style>body{background:#f8fafc;} .card-soft{border:0;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.08);} .chapter-body h1{font-size:1.6rem;margin-bottom:1rem;} .chapter-body p{line-height:1.7;}</style>' +
        '</head><body>' +
        '<div class="container py-4">' +
        '<div class="mb-3"><a class="btn btn-outline-secondary btn-sm" href="/stories/' + safeSlug + '/index.html">&larr; Back to story</a></div>' +
        '<div class="card card-soft p-4" style="background-color:#fffaf5;">' +
        '<div class="d-flex justify-content-between flex-wrap align-items-center mb-3">' +
        '<div><div class="text-muted small">Story: ' + safeSlug + '</div><h1 class="h4 mb-0" id="chapter-title">Chapter ' + idx + '</h1></div>' +
        '<div class="d-flex align-items-center">' + prev + next + '</div>' +
        '</div>' +
        '<div id="status" class="text-muted mb-2 small">Loading chapter...</div>' +
        '<div id="chapter-content" class="chapter-body"></div>' +
        '</div>' +
        '</div>' +
        '<script>' +
        '(function(){' +
        'var slug="' + safeSlug + '";' +
        'var idx=' + idx + ';' +
        'var statusEl=document.getElementById("status");' +
        'var titleEl=document.getElementById("chapter-title");' +
        'var contentEl=document.getElementById("chapter-content");' +
        'var nextLink=document.getElementById("next-link");' +
        'function setStatus(msg,cls){statusEl.textContent=msg;statusEl.className="mb-2 small "+(cls||"text-muted");}' +
        'function loadOutline(){return fetch("/stories/"+slug+"/outline.json").then(function(r){if(r.status===200)return r.json();if(r.status===202){setStatus("Generating outline...","text-info");return new Promise(function(res){setTimeout(function(){loadOutline().then(res);},1500);});}throw new Error("Failed to load outline: "+r.status);});}' +
        'function updateNav(outline){if(!outline||!outline.chapters)return;var total=outline.chapters.length; if(idx>=total) {nextLink.classList.add("disabled"); nextLink.href="#";} else {nextLink.classList.remove("disabled"); nextLink.href="/stories/"+slug+"/chapters/"+(idx+1)+".html";} var ch=outline.chapters[idx-1]; if(ch){titleEl.textContent="Chapter "+idx+": "+(ch.chaptertitle||ch.title||"");}}' +
        'function loadMarkdown(){setStatus("Generating chapter content...","text-info");return fetch("/stories/"+slug+"/chapters/"+idx+".md").then(function(r){if(r.status===200)return r.text();if(r.status===202){setStatus("Chapter is being generated...","text-info");return new Promise(function(res){setTimeout(function(){loadMarkdown().then(res);},1500);});}throw new Error("Failed to load chapter: "+r.status);});}' +
        'loadOutline().then(function(out){updateNav(out);}).catch(function(e){setStatus(e.message,"text-danger");});' +
        'loadMarkdown().then(function(md){setStatus("","text-muted");contentEl.innerHTML=marked.parse(md);}).catch(function(e){setStatus(e.message,"text-danger");});' +
        '})();' +
        '</script>' +
        '</body></html>';
}

async function listStories(baseDir) {
    const stories = [];
    let dirEntries;
    try {
        dirEntries = await fs.promises.readdir(baseDir, {withFileTypes: true});
    } catch (e) {
        return stories;
    }

    for (var i = 0; i < dirEntries.length; i++) {
        const entry = dirEntries[i];
        if (!entry.isDirectory()) continue;
        const slug = entry.name;
        const p = pathForStory(baseDir, slug);
        const hasConfig = await fileExists(p.config);
        if (!hasConfig) continue;
        let conf = {};
        try {
            conf = await readJsonFile(p.config);
        } catch (e) {
            conf = {};
        }
        const outlineReady = await fileExists(p.outline);
        stories.push({
            slug: slug,
            title: conf.title || slug,
            language: conf.language || '',
            idea: conf.storyIdea || conf.storyPrompt || '',
            outlineReady: outlineReady
        });
    }
    return stories;
}

function buildStoryListHtml(stories) {
    var cards = '';
    if (!stories || stories.length === 0) {
        cards = '<div class="alert alert-info">No stories found yet. Add a folder under stories/&lt;slug&gt;/ with a config.json to begin.</div>';
    } else {
        for (var i = 0; i < stories.length; i++) {
            var s = stories[i];
            cards += '<div class="card card-soft mb-3" style="background-color:#fffaf5;">' +
                '<div class="card-body">' +
                '<div class="d-flex justify-content-between flex-wrap align-items-start mb-2">' +
                '<div><h2 class="h5 mb-1">' + xmlEscape(s.title) + '</h2>' +
                '<div class="text-muted small">Slug: ' + xmlEscape(s.slug) + ' • Language: ' + xmlEscape(s.language) + '</div></div>' +
                '<span class="badge ' + (s.outlineReady ? 'bg-success' : 'bg-warning text-dark') + '">' + (s.outlineReady ? 'Outline ready' : 'Outline pending') + '</span>' +
                '</div>' +
                '<p class="mb-3">' + xmlEscape(s.idea) + '</p>' +
                '<a class="btn btn-primary btn-sm" href="/stories/' + xmlEscape(s.slug) + '/index.html">Open story</a>' +
                '</div></div>';
        }
    }

    return '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Story Index</title>' +
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">' +
        '<style>body{background:linear-gradient(135deg,#fdfbfb 0%,#ebedee 100%);} .card-soft{border:0;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.08);} </style>' +
        '</head><body>' +
        '<div class="container py-4">' +
        '<div class="mb-4"><h1 class="h3">Stories</h1><p class="text-muted">Available story configurations detected under stories/.</p></div>' +
        cards +
        '</div>' +
        '</body></html>';
}

async function serveStoryIndex(slug, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const storyConfig = normalizeStoryConfig(storyConfRaw, serverConfig);
    const coverRes = await ensureCover(slug, paths, storyConfig).catch(function () { return null; });
    const coverReady = coverRes && coverRes.status === 'ready';
    const outline = await loadOutline(paths);
    const html = buildIndexHtml(slug, storyConfig, outline, coverReady);
    return buildHtmlResponse(html);
}

async function serveChapterHtml(slug, chapterIndex, serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const storyConfRaw = await loadStoryConfig(paths);
    if (!storyConfRaw) return buildMissing();
    const outline = await loadOutline(paths);
    if (outline && (!outline.chapters || outline.chapters.length < chapterIndex)) return buildMissing();
    const html = buildChapterHtml(slug, chapterIndex);
    return buildHtmlResponse(html);
}

async function serveStoryList(serverConfig) {
    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const stories = await listStories(baseDir);
    const html = buildStoryListHtml(stories);
    return buildHtmlResponse(html);
}

async function importStoryFromExport(slug, payload, serverConfig) {
    if (!payload || typeof payload !== 'object') return {statusCode: 400, headers: {'Content-Type': 'text/plain'}, body: 'Invalid payload'};
    if (payload.version !== 1) return {statusCode: 400, headers: {'Content-Type': 'text/plain'}, body: 'Unsupported version'};

    const baseDir = serverConfig.storiesDir || STORIES_DIR;
    const paths = pathForStory(baseDir, slug);
    const configExists = await fileExists(paths.config);
    if (configExists) return buildConflict('Story already exists');

    const settings = payload.settings || {};
    const state = payload.storyState || {};

    const outline = {
        title: state.storyTitle || settings.storyTitle || slug,
        subtitle: state.storySubtitle || '',
        description: state.storyDescription || '',
        characters: state.storyCharacters || [],
        chapters: (state.outline || []).map(function (ch, idx) {
            return {
                chaptertitle: ch.title || ('Chapter ' + (idx + 1)),
                chaptershortdescription: ch.description || '',
                chapterdetails: ch.details || '',
                chapterText: ch.chapterText || null
            };
        })
    };

    const config = {
        title: outline.title,
        language: settings.language || null,
        storyIdea: settings.storyPrompt || '',
        model: settings.model || serverConfig.chatModel || DEFAULT_CHAT_MODEL,
        temperature: settings.temperature !== undefined ? settings.temperature : (serverConfig.temperature !== undefined ? serverConfig.temperature : DEFAULT_TEMPERATURE),
        outlinePrompt: settings.outlineSystemPrompt || serverConfig.outlinePrompt || DEFAULT_OUTLINE_PROMPT,
        chapterPrompt: settings.chapterSystemPrompt || serverConfig.chapterPrompt || DEFAULT_CHAPTER_PROMPT,
        ttsModel: settings.openaiTTSModel || serverConfig.ttsModel || DEFAULT_TTS_MODEL,
        voice: settings.openaiVoice || serverConfig.voice || DEFAULT_VOICE,
        ttsInstructions: settings.openaiInstructions || ''
    };

    try {
        await ensureDir(paths.base);
        await ensureDir(paths.chaptersDir);
        await writeFileAtomic(paths.config, JSON.stringify(config, null, 2), 'utf8');
        await writeFileAtomic(paths.outline, JSON.stringify(outline, null, 2), 'utf8');

        // write any provided chapter texts to markdown files
        for (var i = 0; i < outline.chapters.length; i++) {
            const chapterText = outline.chapters[i].chapterText;
            if (chapterText) {
                const title = outline.chapters[i].chaptertitle || ('Chapter ' + (i + 1));
                const md = chapterMarkdown(title, chapterText, outline.chapters[i].chaptershortdescription);
                await writeFileAtomic(paths.chapterFile(i + 1), md, 'utf8');
            }
        }
        logInfo('Imported story ' + slug + ' via export payload');
        return buildCreated({status: 'created', slug: slug});
    } catch (e) {
        logError('Failed importing story ' + slug, e);
        return {statusCode: 500, headers: {'Content-Type': 'text/plain'}, body: 'Failed to import story'};
    }
}

module.exports = {
    serveOutline,
    serveChapterMarkdown,
    serveChapterAudio,
    serveFeed,
    servePlaylist,
    serveZip,
    serveCoverImage,
    serveStoryIndex,
    serveChapterHtml,
    serveStoryList,
    importStoryFromExport,
    STORIES_DIR
};
