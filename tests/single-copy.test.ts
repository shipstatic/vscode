import { describe, expect, it } from 'vitest';
import { assertSingleCopy, packageRoots, SINGLE_COPY } from '../scripts/single-copy.mjs';

/**
 * @file The build's realm fence, watched failing.
 *
 * `esbuild.mjs` runs `assertSingleCopy` on every build, so the PASSING path is
 * exercised constantly and proves nothing on its own — a check that always
 * returns early looks identical to one that works. What needs proving is that
 * it fires, and against a real esbuild metafile that only happens when the
 * install is already broken.
 *
 * So the metafiles below are synthetic and hand-written: two pnpm store paths
 * for one package name is exactly what a diverged pin produces, and it is the
 * one input this fence exists to reject.
 */

/** The shape esbuild emits: `inputs` keyed by resolved path. */
const metafileOf = (...files: string[]) => ({
  inputs: Object.fromEntries(files.map((f) => [f, { bytes: 0, imports: [] }])),
});

const STORE = 'node_modules/.pnpm';

describe('single-copy fence', () => {
  it('passes when every fenced package resolved once', () => {
    const metafile = metafileOf(
      `${STORE}/@shipstatic+types@2.5.0/node_modules/@shipstatic/types/dist/index.js`,
      `${STORE}/@shipstatic+ship@2.0.0/node_modules/@shipstatic/ship/dist/index.js`,
      `${STORE}/zod@4.4.3/node_modules/zod/index.js`,
      'src/mcp-entry.ts',
    );

    expect(() => assertSingleCopy('bundle', metafile)).not.toThrow();
  });

  it('fires when one fenced package resolved twice', () => {
    // The diverged-pin shape: this repo and @shipstatic/mcp asking for
    // different versions, so pnpm installs both and esbuild bundles both.
    const metafile = metafileOf(
      `${STORE}/@shipstatic+types@2.5.0/node_modules/@shipstatic/types/dist/index.js`,
      `${STORE}/@shipstatic+types@2.4.0/node_modules/@shipstatic/types/dist/index.js`,
    );

    expect(() => assertSingleCopy('dist/mcp-server.js', metafile)).toThrow(/@shipstatic\/types/);
  });

  it('names the bundle and both offending paths, so the fix is obvious', () => {
    const metafile = metafileOf(
      `${STORE}/zod@4.4.3/node_modules/zod/index.js`,
      `${STORE}/zod@3.99.0/node_modules/zod/index.js`,
    );

    expect(() => assertSingleCopy('dist/mcp-server.js', metafile)).toThrow(
      /dist\/mcp-server\.js[\s\S]*zod@4\.4\.3[\s\S]*zod@3\.99\.0/,
    );
  });

  it('ignores duplicates of packages nobody fenced', () => {
    // The list is deliberately short: these four carry identity that splits.
    // A second copy of a leaf utility is bloat, not a correctness problem, and
    // failing the build over it would train people to widen the list.
    const metafile = metafileOf(
      `${STORE}/junk@4.0.1/node_modules/junk/index.js`,
      `${STORE}/junk@3.0.0/node_modules/junk/index.js`,
    );

    expect(() => assertSingleCopy('bundle', metafile)).not.toThrow();
  });

  it('reads the LAST node_modules segment, so a nested install is a distinct copy', () => {
    // pnpm store paths contain the marker more than once; a naive `indexOf`
    // would collapse a nested install into its parent and miss the split.
    const roots = packageRoots(
      metafileOf(`${STORE}/a@1/node_modules/pkg/node_modules/zod/index.js`),
    );

    expect(roots.get('zod')).toEqual(new Set([`${STORE}/a@1/node_modules/pkg/node_modules/zod`]));
  });

  it('fences the MCP SDK — the realm `server.connect(transport)` depends on', () => {
    expect(SINGLE_COPY).toContain('@modelcontextprotocol/sdk');
  });
});
