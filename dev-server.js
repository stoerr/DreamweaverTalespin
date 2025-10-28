const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const baseDir = path.join(__dirname, 'src');

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

    let filePath = (req.url || '/').split('?')[0];
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    const relativePath = filePath.replace(/^\/+/, '') || 'index.html';
    const fullPath = path.join(baseDir, relativePath);

    const resolvedPath = path.resolve(fullPath);
    const resolvedBase = path.resolve(baseDir);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 - Forbidden');
        console.log(`  -> 403 Forbidden: Directory traversal attempt blocked for ${filePath}`);
        return;
    }

    const ext = path.extname(relativePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 - File Not Found');
                console.log(`  -> 404 Not Found: ${fullPath}`);
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 - Internal Server Error');
                console.error(`  -> 500 Error while reading ${fullPath}:`, err);
            }
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(data);
            console.log(`  -> 200 OK (${contentType}) -> ${fullPath}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Test server running at http://localhost:${PORT}/`);
});

