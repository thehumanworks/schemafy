#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  ROOT_PACKAGE_NAME,
  TARGETS,
  bundledBinarySubpath,
  githubArtifactName,
} = require('../npm/schemafy/lib/targets.js');
const { stageBinaries } = require('./prepare-npm-packages.js');

const repoRoot = path.resolve(__dirname, '..');
const ROOT_WORKSPACE = 'npm/schemafy';
const DEFAULT_GITHUB_WORKFLOW = 'build.yml';
const PUBLISH_WORKSPACES = [ROOT_WORKSPACE];

function getMissingBinaries(rootDir = repoRoot) {
  return TARGETS.flatMap((target) => {
    const binaryPath = path.join(
      rootDir,
      'npm',
      'schemafy',
      bundledBinarySubpath(target),
    );

    return fs.existsSync(binaryPath) ? [] : [`${target.rustTarget}: ${binaryPath}`];
  });
}

function verifyPublishablePackages(rootDir = repoRoot) {
  const launcherPath = path.join(rootDir, ROOT_WORKSPACE, 'bin', 'schemafy.js');
  if (!fs.existsSync(launcherPath)) {
    throw new Error(
      `${ROOT_PACKAGE_NAME} launcher entrypoint is missing: ${launcherPath}`,
    );
  }

  const missingBinaries = getMissingBinaries(rootDir);

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

function preparePublishablePackages(options = {}, rootDir = repoRoot, dependencies = {}) {
  const launcherPath = path.join(rootDir, ROOT_WORKSPACE, 'bin', 'schemafy.js');
  if (!fs.existsSync(launcherPath)) {
    verifyPublishablePackages(rootDir);
    return;
  }

  if (getMissingBinaries(rootDir).length > 0) {
    const artifactsDir = options.artifactsDir || downloadGitHubArtifacts(options, rootDir, dependencies);

    try {
      stageBinaries(artifactsDir, rootDir);
    } finally {
      if (!options.artifactsDir) {
        fs.rmSync(artifactsDir, { recursive: true, force: true });
      }
    }
  }

  verifyPublishablePackages(rootDir);
}

function publishPackages(npmArgs = [], rootDir = repoRoot, options = {}, dependencies = {}) {
  preparePublishablePackages(options, rootDir, dependencies);

  for (const workspace of PUBLISH_WORKSPACES) {
    const spawn = dependencies.spawnSync || spawnSync;
    const result = spawn('npm', ['publish', '--workspace', workspace, ...npmArgs], {
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

function downloadGitHubArtifacts(options = {}, rootDir = repoRoot, dependencies = {}) {
  const repo = options.githubRepo || process.env.SCHEMAFY_GITHUB_REPO || resolveGitHubRepo(rootDir, dependencies);
  const commit = options.githubCommit || process.env.SCHEMAFY_GITHUB_COMMIT || readCommand(
    dependencies,
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: rootDir },
  );
  const workflow = options.githubWorkflow || process.env.SCHEMAFY_GITHUB_WORKFLOW || DEFAULT_GITHUB_WORKFLOW;
  const runId = options.githubRunId || process.env.SCHEMAFY_GITHUB_RUN_ID || resolveGitHubRunId(
    { repo, commit, workflow },
    rootDir,
    dependencies,
  );
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schemafy-gh-artifacts-'));

  readCommand(
    dependencies,
    'gh',
    [
      'run',
      'download',
      String(runId),
      '--repo',
      repo,
      '--dir',
      artifactsDir,
      ...TARGETS.flatMap((target) => ['--name', githubArtifactName(target)]),
    ],
    { cwd: rootDir },
  );

  return artifactsDir;
}

function resolveGitHubRepo(rootDir = repoRoot, dependencies = {}) {
  const remoteUrl = readCommand(
    dependencies,
    'git',
    ['config', '--get', 'remote.origin.url'],
    { cwd: rootDir },
  );
  const parsed = parseGitHubRepo(remoteUrl);

  if (!parsed) {
    throw new Error(
      `failed to determine GitHub repo from remote.origin.url (${remoteUrl}); pass --github-repo owner/repo`,
    );
  }

  return parsed;
}

function resolveGitHubRunId({ repo, commit, workflow }, rootDir = repoRoot, dependencies = {}) {
  const output = readCommand(
    dependencies,
    'gh',
    [
      'run',
      'list',
      '--repo',
      repo,
      '--workflow',
      workflow,
      '--commit',
      commit,
      '--status',
      'success',
      '--limit',
      '1',
      '--json',
      'databaseId',
    ],
    { cwd: rootDir },
  );
  const runs = JSON.parse(output);
  const runId = runs[0]?.databaseId;

  if (!runId) {
    throw new Error(
      `no successful ${workflow} run found for commit ${commit} in ${repo}; push the commit and wait for the workflow to finish, or pass --github-run-id`,
    );
  }

  return runId;
}

function parseGitHubRepo(remoteUrl) {
  const normalized = remoteUrl.trim();
  const match = normalized.match(
    /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/,
  );
  return match?.[1] || null;
}

function parseCliArgs(argv, env = process.env) {
  const publishOptions = {};
  const npmArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    if (arg === '--artifacts-dir') {
      if (!nextValue) {
        throw new Error('missing value for --artifacts-dir');
      }
      publishOptions.artifactsDir = path.resolve(repoRoot, nextValue);
      index += 1;
      continue;
    }

    if (arg === '--github-repo') {
      if (!nextValue) {
        throw new Error('missing value for --github-repo');
      }
      publishOptions.githubRepo = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--github-run-id') {
      if (!nextValue) {
        throw new Error('missing value for --github-run-id');
      }
      publishOptions.githubRunId = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--github-workflow') {
      if (!nextValue) {
        throw new Error('missing value for --github-workflow');
      }
      publishOptions.githubWorkflow = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--github-commit') {
      if (!nextValue) {
        throw new Error('missing value for --github-commit');
      }
      publishOptions.githubCommit = nextValue;
      index += 1;
      continue;
    }

    npmArgs.push(arg);
  }

  if (!publishOptions.artifactsDir && env.SCHEMAFY_NPM_ARTIFACTS_DIR) {
    publishOptions.artifactsDir = path.resolve(repoRoot, env.SCHEMAFY_NPM_ARTIFACTS_DIR);
  }

  if (
    !publishOptions.githubRunId &&
    npmArgs.length > 0 &&
    /^\d+$/.test(npmArgs[0])
  ) {
    [publishOptions.githubRunId] = npmArgs.splice(0, 1);
  }

  return { npmArgs, publishOptions };
}

function readCommand(dependencies, command, args, options) {
  const exec = dependencies.execFileSync || execFileSync;
  return String(
    exec(command, args, {
      ...options,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ).trim();
}

if (require.main === module) {
  try {
    const { npmArgs, publishOptions } = parseCliArgs(process.argv.slice(2));
    publishPackages(npmArgs, repoRoot, publishOptions);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_GITHUB_WORKFLOW,
  PUBLISH_WORKSPACES,
  downloadGitHubArtifacts,
  getMissingBinaries,
  parseCliArgs,
  parseGitHubRepo,
  preparePublishablePackages,
  publishPackages,
  resolveGitHubRepo,
  resolveGitHubRunId,
  verifyPublishablePackages,
};
