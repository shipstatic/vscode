import { describe, expect, it } from 'vitest';
import {
  ABSENT_FROM_EXTENSION,
  assertAbsent,
  assertSingleCopy,
  packageRoots,
  SINGLE_COPY,
} from '../scripts/bundle-integrity.mjs';

/**
 * @file The build's bundle fences, watched failing.
 *
 * `esbuild.mjs` runs both assertions on every build, so the PASSING paths are
 * exercised constantly and prove nothing on their own — a check that always
 * returns early looks identical to one that works. What needs proving is that
 * each FIRES, and against a real esbuild metafile that only happens when the
 * install is already broken.
 *
 * So the metafiles below are synthetic and hand-written: two pnpm store paths
 * for one package name is what a diverged pin produces, and a store path for a
 * package the bundle must not carry is what a graph leak produces. Both are
 * exactly the inputs the fences exist to reject — and the second is not
 * hypothetical: the absence fence fired on a REAL leak the day it was written,
 * +142KB of MCP SDK riding into the extension-host bundle through a
 * vocabulary import, before `@shipstatic/mcp`'s `sideEffects` field existed.
 */

/**
 * The shape esbuild emits, reduced to what the fences read: `outputs[].inputs`
 * — the files that CONTRIBUTED BYTES to the bundle. Top-level `inputs` is
 * deliberately populated with a decoy the fences must ignore: it lists every
 * module esbuild PARSED, including ones tree-shaking dropped, and a fence
 * reading it calls a successfully-shaken graph a leak (caught live — see the
 * note on `bundledFiles` in the module).
 */
const PARSED_ONLY =
  'node_modules/.pnpm/parsed-not-bundled@1.0.0/node_modules/parsed-not-bundled/index.js';
const metafileOf = (...files: string[]) => ({
  inputs: Object.fromEntries([...files, PARSED_ONLY].map((f) => [f, { bytes: 0, imports: [] }])),
  outputs: {
    'dist/bundle.js': {
      inputs: Object.fromEntries(files.map((f) => [f, { bytesInOutput: 1 }])),
    },
  },
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

describe('absence fence', () => {
  it('passes when the forbidden packages are simply not there', () => {
    const metafile = metafileOf(
      `${STORE}/@shipstatic+mcp@1.0.0/node_modules/@shipstatic/mcp/dist/vocabulary.js`,
      'src/extension.ts',
    );

    expect(() => assertAbsent('bundle', metafile, ABSENT_FROM_EXTENSION)).not.toThrow();
  });

  it('fires when a forbidden package appears at all — one copy is already the leak', () => {
    // Unlike the single-copy fence, ANY presence is the failure: the extension
    // host has no server to run, so the first byte of SDK is a graph leak.
    const metafile = metafileOf(
      `${STORE}/@modelcontextprotocol+sdk@1.30.0/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`,
    );

    expect(() => assertAbsent('dist/extension.js', metafile, ABSENT_FROM_EXTENSION)).toThrow(
      /@modelcontextprotocol\/sdk/,
    );
  });

  it('names the usual cause, so the fix is obvious', () => {
    const metafile = metafileOf(
      `${STORE}/@modelcontextprotocol+sdk@1.30.0/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`,
    );

    expect(() => assertAbsent('dist/extension.js', metafile, ABSENT_FROM_EXTENSION)).toThrow(
      /sideEffects/,
    );
  });
});
