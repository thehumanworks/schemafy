const assert = require('node:assert/strict');
const test = require('node:test');

const { binarySubpath, TARGETS } = require('../lib/targets.js');
const {
  createPlatformManifest,
  createRootManifest,
} = require('../../../scripts/prepare-npm-packages.js');

test('generates publish-safe bin paths', () => {
  const rootManifest = createRootManifest('1.2.3');
  assert.equal(rootManifest.bin.schemafy, 'bin/schemafy.js');

  for (const target of TARGETS) {
    const manifest = createPlatformManifest('1.2.3', target);
    assert.equal(manifest.bin.schemafy, binarySubpath(target));
    assert.equal(manifest.bin.schemafy.startsWith('./'), false);
  }
});
