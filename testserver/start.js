#!/usr/bin/env node
// Simple launcher to run the story server from the test fixture directory.
// It sets the working directory to this folder so server.conf and stories/ are picked up.
const path = require('path');
const server = require('../storyserver/server');

process.chdir(path.join(__dirname));
server.start();
