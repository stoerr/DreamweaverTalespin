const {serveOutline, serveChapterMarkdown, serveChapterAudio, serveFeed, serveStoryIndex, serveChapterHtml, serveStoryList, servePlaylist, serveZip, serveEpub, serveCoverImage, importStoryFromExport} = require('./storygen');

function sendResponse(res, result) {
    res.statusCode = result.statusCode;
    if (result.headers) {
        Object.keys(result.headers).forEach(function (key) {
            res.setHeader(key, result.headers[key]);
        });
    }
    if (result.bodyStream) {
        result.bodyStream.on('error', function (err) {
            if (res.headersSent) {
                res.destroy(err);
            } else {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Internal server error');
            }
        });
        result.bodyStream.pipe(res);
        return;
    }
    if (result.body !== undefined) res.end(result.body);
    else res.end();
}

async function readRequestBody(req, limitBytes) {
    return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
            size += chunk.length;
            if (limitBytes && size > limitBytes) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', function () {
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
}

async function handleRequest(req, res, serverConfig) {
    const method = req.method || 'GET';

    const parsed = new URL(req.url, 'http://localhost');
    const pathname = parsed.pathname || '/';
    if (pathname === '/') {
        res.statusCode = 302;
        res.setHeader('Location', '/storyindex.html');
        res.end();
        return;
    }
    if (pathname === '/storyindex.html' || pathname === '/storyindex') {
        if (method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Method not allowed');
            return;
        }
        const result = await serveStoryList(serverConfig).catch(function (e) {
            return {statusCode: 500, headers: {'Content-Type': 'text/plain'}, body: 'Internal server error: ' + e.message};
        });
        sendResponse(res, result);
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
        if (method === 'POST' && parts.length === 2) {
            if (serverConfig.importToken) {
                const token = req.headers['x-story-import-token'];
                if (token !== serverConfig.importToken) {
                    res.statusCode = 401;
                    res.setHeader('Content-Type', 'text/plain');
                    res.end('Unauthorized');
                    return;
                }
            }
            const bodyBuf = await readRequestBody(req, 10 * 1024 * 1024);
            let payload = null;
            try {
                payload = JSON.parse(bodyBuf.toString('utf8'));
            } catch (e) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Invalid JSON');
                return;
            }
            const result = await importStoryFromExport(slug, payload, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Method not allowed');
            return;
        }

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
        if (parts[2] === 'audio' && parts.length === 4 && parts[3] === slug + '.zip') {
            const result = await serveZip(slug, serverConfig);
            sendResponse(res, result);
            return;
        }
        if (parts[2] === slug + '.epub' && parts.length === 3) {
            const result = await serveEpub(slug, serverConfig);
            sendResponse(res, result);
            return;
        }
        if (parts[2] === 'cover.jpg' && parts.length === 3) {
            const result = await serveCoverImage(slug, serverConfig);
            sendResponse(res, result);
            return;
        }

        if (parts[2] === 'chapters' && parts.length === 4) {
            const chapterMatch = parts[3].match(/^0*([0-9]+)\.(md|mp3|html)$/);
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
