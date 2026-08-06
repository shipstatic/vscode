import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { assertSingleCopy } from './scripts/single-copy.mjs';

const require = createRequire(import.meta.url);
const isWatch = process.argv.includes('--watch');

/**
 * The bundled MCP server reports the version of the package that IS bundled —
 * read from the pin's own manifest at build time, never written out. The
 * version-from-pin law; the hosted worker derives its version the same way.
 */
const mcpVersion = require('@shipstatic/mcp/package.json').version;

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Dev builds only. The `.vscodeignore` allowlist ships the two bundles and
  // no `.map`, so a packaged build with sourcemaps carries a
  // `sourceMappingURL` pointing at a file that is not in the `.vsix`.
  sourcemap: isWatch,
  minify: !isWatch,
  metafile: true,
};

// 1. Extension entry point (runs in VS Code's extension host)
const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// 2. MCP server entry point (runs as a separate child process).
//
// Both entry points are OUR source. This one composes `@shipstatic/mcp`'s
// exported `createServer` with a stdio transport — see `src/mcp-entry.ts` for
// why that is a rewrite rather than a refactor. Two onLoad plugins used to live
// here, patching the mcp's compiled output with regexes; they are gone, and
// nothing in this file knows anything about that package's internal layout.
const mcpConfig = {
  ...shared,
  entryPoints: ['src/mcp-entry.ts'],
  outfile: 'dist/mcp-server.js',
  define: { MCP_VERSION: JSON.stringify(mcpVersion) },
};

if (isWatch) {
  const [ctx1, ctx2] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(mcpConfig),
  ]);
  await Promise.all([ctx1.watch(), ctx2.watch()]);
} else {
  const [extension, mcp] = await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(mcpConfig),
  ]);
  assertSingleCopy('dist/extension.js', extension.metafile);
  assertSingleCopy('dist/mcp-server.js', mcp.metafile);
}
