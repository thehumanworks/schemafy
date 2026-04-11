#!/usr/bin/env node

const { formatMissingBinaryError, resolveBinary } = require('../lib/targets.js');

if (process.env.SCHEMAFY_SKIP_POSTINSTALL === '1') {
  process.exit(0);
}

const resolution = resolveBinary();
if (!resolution.binaryPath) {
  console.error(formatMissingBinaryError(resolution));
  process.exit(1);
}
