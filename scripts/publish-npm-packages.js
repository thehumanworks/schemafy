#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT_PACKAGE_NAME, TARGETS } = require('../npm/schemafy/lib/targets.js');

const repoRoot = path.resolve(__dirname, '..');
const ROOT_WORKSPACE = 'npm/schemafy';
const PUBLISH_WORKSPACES = [
  ...TARGETS.map((target) => path.posix.join('npm', target.packageDirectoryName)),
  ROOT_WORKSPACE,
];

function verifyPublishablePackages(rootDir = repoRoot) {
  const launcherPath = path.join(rootDir, ROOT_WORKSPACE, 'bin', 'schemafy.js');
  if (!fs.existsSync(launcherPath)) {
    throw new Error(
      `${ROOT_PACKAGE_NAME} launcher entrypoint is missing: ${launcherPath}`,
    );
  }

  const missingBinaries = TARGETS.flatMap((target) => {
    const binaryPath = path.join(
      rootDir,
      'npm',
      target.packageDirectoryName,
      'bin',
      target.binaryName,
    );

    return fs.existsSync(binaryPath) ? [] : [`${target.packageName}: ${binaryPath}`];
  });

  if (missingBinaries.length > 0) {
    throw new Error(
      [
        'missing staged binaries for npm platform packages:',
        ...missingBinaries.map((entry) => `  - ${entry}`),
        'Build all target binaries into dist/npm and run `npm run npm:stage` before publishing.',
      ].join('\n'),
    );
  }
}

function publishPackages(npmArgs = [], rootDir = repoRoot) {
  verifyPublishablePackages(rootDir);

  for (const workspace of PUBLISH_WORKSPACES) {
    const result = spawnSync('npm', ['publish', '--workspace', workspace, ...npmArgs], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      process.exit(result.status === null ? 1 : result.status);
    }
  }
}

if (require.main === module) {
  try {
    publishPackages(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  PUBLISH_WORKSPACES,
  publishPackages,
  verifyPublishablePackages,
};
