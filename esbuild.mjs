import * as esbuild from 'esbuild';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const isWatch = process.argv.includes('--watch');
const mcpVersion = require('@shipstatic/mcp/package.json').version;

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: !isWatch,
};

// 1. Extension entry point (runs in VS Code's extension host)
const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// 2. MCP server entry point (runs as separate child process)
// Bundles @shipstatic/mcp and ALL its dependencies into a single file.
// No modifications to @shipstatic/mcp — esbuild reads its entry point directly.
const mcpConfig = {
  ...shared,
  entryPoints: { 'mcp-server': require.resolve('@shipstatic/mcp') },
  outfile: 'dist/mcp-server.js',
  plugins: [
    // Strip the source shebang — VS Code spawns with `node` explicitly
    {
      name: 'strip-shebang',
      setup(build) {
        build.onLoad({ filter: /@shipstatic[\\/]mcp[\\/]dist[\\/]index\.js$/ }, async (args) => {
          const { readFile } = await import('fs/promises');
          let contents = await readFile(args.path, 'utf8');
          if (contents.startsWith('#!')) {
            contents = contents.replace(/^#![^\n]*\n/, '');
          }
          return { contents, loader: 'js' };
        });
      },
    },
    // Inline the MCP version string. The MCP source loads it via
    // `createRequire(import.meta.url)('../package.json')`, which fails when
    // bundled to CJS (no `import.meta.url`). We read the version statically
    // from the installed @shipstatic/mcp/package.json — no patching of the
    // MCP source itself.
    {
      name: 'inline-mcp-version',
      setup(build) {
        build.onLoad({ filter: /@shipstatic[\\/]mcp[\\/]dist[\\/]server\.js$/ }, async (args) => {
          const { readFile } = await import('fs/promises');
          const original = await readFile(args.path, 'utf8');
          const contents = original.replace(
            /const \{ version \} = createRequire\(import\.meta\.url\)\('\.\.\/package\.json'\);?/,
            `const version = ${JSON.stringify(mcpVersion)};`,
          );
          return { contents, loader: 'js' };
        });
      },
    },
  ],
};

if (isWatch) {
  const [ctx1, ctx2] = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(mcpConfig),
  ]);
  await Promise.all([ctx1.watch(), ctx2.watch()]);
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(mcpConfig),
  ]);
}
