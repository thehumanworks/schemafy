#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { formatMissingBinaryError, resolveBinary } = require('../lib/targets.js');

const resolution = resolveBinary();
if (!resolution.binaryPath) {
  console.error(formatMissingBinaryError(resolution));
  process.exit(1);
}

const result = spawnSync(resolution.binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
