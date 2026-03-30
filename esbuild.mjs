import * as esbuild from 'esbuild';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const isWatch = process.argv.includes('--watch');

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
  // Strip the source shebang — VS Code spawns with `node` explicitly
  plugins: [{
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
  }],
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
