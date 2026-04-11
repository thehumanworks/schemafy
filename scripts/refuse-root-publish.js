#!/usr/bin/env node

console.error(
  'Refusing to publish the workspace root. Use `npm run npm:publish` or `npm run npm:publish:dry-run` instead.',
);
process.exit(1);
