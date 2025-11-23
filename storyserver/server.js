const http = require('http');
const fs = require('fs');
const path = require('path');
const {handleRequest} = require('./mapper');
const {STORIES_DIR} = require('./storygen');

function parseConfigLine(line) {
    const idx = line.indexOf('=');
    if (idx === -1) return null;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) return null;
    return {key: key, value: value};
}

function loadServerConfig() {
    const defaults = {
        port: 3001,
        storiesDir: STORIES_DIR,
        chatModel: 'gpt-5.1',
        temperature: 1,
        ttsModel: 'tts-1-hd',
        voice: 'alloy',
        serviceTier: null
    };

    const confFile = path.resolve(process.cwd(), 'server.conf');
    let parsed = {};
    try {
        const text = fs.readFileSync(confFile, 'utf8');
        const lines = text.split(/\r?\n/);
        lines.forEach(function (line) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const parsedLine = parseConfigLine(trimmed);
            if (!parsedLine) return;
            parsed[parsedLine.key] = parsedLine.value;
        });
    } catch (e) {
        // no server.conf present – keep defaults
    }

    const cfg = Object.assign({}, defaults, parsed);
    if (cfg.port) cfg.port = parseInt(cfg.port, 10);
    if (cfg.temperature !== undefined) cfg.temperature = parseFloat(cfg.temperature);
    if (cfg.storiesDir) cfg.storiesDir = path.resolve(cfg.storiesDir);

    return cfg;
}

function start() {
    const serverConfig = loadServerConfig();

    const server = http.createServer(function (req, res) {
        handleRequest(req, res, serverConfig);
    });

    server.listen(serverConfig.port, function () {
        console.error(new Date().toISOString().split('.')[0] + ' INFO ' + 'Story server listening on port ' + serverConfig.port + ' using stories dir ' + serverConfig.storiesDir);
    });
}

if (require.main === module) {
    start();
}

module.exports = {start};
