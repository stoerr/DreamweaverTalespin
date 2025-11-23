const https = require('https');

function getApiKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('Missing OPENAI_API_KEY environment variable');
    return key;
}

function performRequest(path, payload, expectBinary, extraHeaders) {
    return new Promise((resolve, reject) => {
        const apiKey = getApiKey();
        const data = JSON.stringify(payload);

        const options = {
            hostname: 'api.openai.com',
            path: path,
            method: 'POST',
            headers: Object.assign({
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Authorization': 'Bearer ' + apiKey
            }, extraHeaders || {})
        };

        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || '';

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let msg = 'OpenAI request failed with status ' + res.statusCode;
                    if (contentType.indexOf('application/json') >= 0) {
                        try {
                            const parsed = JSON.parse(buffer.toString('utf8'));
                            if (parsed && parsed.error && parsed.error.message) msg = parsed.error.message;
                        } catch (e) {
                            msg = msg + ' ' + buffer.toString('utf8');
                        }
                    } else {
                        msg = msg + ' ' + buffer.toString('utf8');
                    }
                    reject(new Error(msg));
                    return;
                }

                if (expectBinary) {
                    resolve(buffer);
                    return;
                }

                const text = buffer.toString('utf8');
                if (contentType.indexOf('application/json') >= 0) {
                    try {
                        resolve(JSON.parse(text));
                        return;
                    } catch (e) {
                        reject(new Error('Failed to parse JSON response: ' + e.message));
                        return;
                    }
                }
                resolve(text);
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function callChatCompletions(messages, opts) {
    const body = {
        model: opts && opts.model ? opts.model : 'gpt-5.1',
        messages: messages,
        temperature: opts && opts.temperature !== undefined ? opts.temperature : 1,
        max_completion_tokens: opts && opts.maxTokens ? opts.maxTokens : 10240
    };
    if (opts && opts.response_format) body.response_format = opts.response_format;
    if (opts && opts.service_tier) body.service_tier = opts.service_tier;

    const response = await performRequest('/v1/chat/completions', body, false, null);
    const message = response && response.choices && response.choices[0] && response.choices[0].message;
    if (!message || typeof message.content !== 'string') {
        throw new Error('Invalid response from OpenAI chat completions');
    }
    return message.content;
}

async function textToSpeech(text, opts) {
    const body = {
        model: opts && opts.model ? opts.model : 'tts-1-hd',
        voice: opts && opts.voice ? opts.voice : 'alloy',
        input: text
    };
    if (opts && opts.instructions) body.instructions = opts.instructions;

    const headers = {'Accept': 'audio/mpeg'};
    const buffer = await performRequest('/v1/audio/speech', body, true, headers);
    return buffer;
}

async function generateImage(prompt, opts) {
    const body = {
        model: (opts && opts.model) || 'gpt-image-1',
        prompt: prompt,
        size: (opts && opts.size) || '1024x1024',
        response_format: 'b64_json'
    };
    const response = await performRequest('/v1/images/generations', body, false, null);
    const entry = response && response.data && response.data[0];
    const b64 = entry && entry.b64_json;
    if (b64) return Buffer.from(b64, 'base64');
    if (entry && entry.url) throw new Error('Image generation returned URL, expected base64 content');
    throw new Error('Invalid response from OpenAI image generation');
}

module.exports = {
    callChatCompletions,
    textToSpeech,
    generateImage
};
