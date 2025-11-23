const url = require('url');
const {serveOutline, serveChapterMarkdown, serveChapterAudio, serveFeed, serveStoryIndex, serveChapterHtml, serveStoryList, servePlaylist} = require('./storygen');

function sendResponse(res, result) {
    res.statusCode = result.statusCode;
    if (result.headers) {
        Object.keys(result.headers).forEach(function (key) {
            res.setHeader(key, result.headers[key]);
        });
    }
    if (result.body !== undefined) res.end(result.body);
    else res.end();
}

async function handleRequest(req, res, serverConfig) {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Method not allowed');
        return;
    }

    const parsed = url.parse(req.url);
    const pathname = parsed.pathname || '/';
    if (pathname === '/storyindex.html' || pathname === '/storyindex') {
        try {
            const result = await serveStoryList(serverConfig);
            sendResponse(res, result);
        } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Internal server error: ' + e.message);
        }
        return;
    }

    const parts = (pathname).split('/').filter(function (p) { return p; });

    if (parts.length < 2 || parts[0] !== 'stories') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not found');
        return;
    }

    const slug = parts[1];

    try {
        if (parts.length === 2) {
            const result = await serveStoryIndex(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'index.html' && parts.length === 3) {
            const result = await serveStoryIndex(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'outline.json' && parts.length === 3) {
            const result = await serveOutline(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'feed.rss' && parts.length === 3) {
            const result = await serveFeed(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'audio' && parts.length === 4 && parts[3] === slug + '.m3u') {
            const result = await servePlaylist(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'chapters' && parts.length === 4) {
            const chapterMatch = parts[3].match(/^([0-9]+)\.(md|mp3|html)$/);
            if (!chapterMatch) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Not found');
                return;
            }
            const index = parseInt(chapterMatch[1], 10);
            if (chapterMatch[2] === 'md') {
                const result = await serveChapterMarkdown(slug, index, serverConfig);
                sendResponse(res, result);
                return;
            }
            if (chapterMatch[2] === 'mp3') {
                const result = await serveChapterAudio(slug, index, serverConfig);
                sendResponse(res, result);
                return;
            }
            if (chapterMatch[2] === 'html') {
                const result = await serveChapterHtml(slug, index, serverConfig);
                sendResponse(res, result);
                return;
            }
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not found');
    } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal server error: ' + e.message);
    }
}

module.exports = {
    handleRequest
};
