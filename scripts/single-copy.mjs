/**
 * Realm integrity for the two bundles — the check `esbuild.mjs` runs on build.
 *
 * Its own module rather than a closure inside the bundler config so the
 * behaviour is testable: `tests/single-copy.test.ts` feeds it a synthetic
 * metafile and asserts it FIRES. A fence nobody has watched fail is a fence
 * nobody knows the shape of, and this one guards a failure that is silent by
 * construction.
 */

/**
 * Packages that must resolve to exactly ONE copy inside a bundle.
 *
 * Not chosen for size. Each carries identity that two copies would split:
 *
 *   - `@shipstatic/types` owns the platform constants. Two copies means
 *     `PUBLIC_DEPLOYMENT_TTL_SECONDS` could be read from two versions, so the
 *     palette notification and the bundled server's instructions would state
 *     different durations for one fact.
 *   - `@shipstatic/ship` carries `ShipError`. `isShipError` is deliberately
 *     STRUCTURAL rather than `instanceof`, so a split realm degrades subtly
 *     instead of failing loudly — which is exactly why a fence beats noticing.
 *   - `@modelcontextprotocol/sdk` is the reason the extension may declare it
 *     directly at all: `server.connect(transport)` must receive a transport
 *     from the same realm as the server `@shipstatic/mcp` built.
 *   - `zod` backs the tool schemas, and the SDK peer-resolves it. Measured
 *     2026-08-06: one copy (4.4.3) shared by both, so it is fenced with the
 *     others rather than recorded as a tolerated duplicate.
 *
 * The property is otherwise held by three repos' exact pins agreeing, by hand.
 * `web/www` learned the same lesson from duplicate React through
 * symlink-realpath resolution — caught only in a live browser, now fenced by
 * its own `check-bundle.mjs`.
 */
export const SINGLE_COPY = [
  '@shipstatic/types',
  '@shipstatic/ship',
  '@modelcontextprotocol/sdk',
  'zod',
];

/** Distinct installed roots per package name, read from esbuild's own metafile. */
export function packageRoots(metafile) {
  const roots = new Map();
  for (const file of Object.keys(metafile.inputs)) {
    // The LAST `node_modules/` segment: a nested install is a different copy,
    // and pnpm's store paths contain the marker more than once.
    const marker = 'node_modules/';
    const at = file.lastIndexOf(marker);
    if (at === -1) continue;
    const parts = file.slice(at + marker.length).split('/');
    const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    if (!roots.has(name)) roots.set(name, new Set());
    roots.get(name).add(file.slice(0, at + marker.length) + name);
  }
  return roots;
}

/** @throws when a `SINGLE_COPY` package resolved to more than one root. */
export function assertSingleCopy(label, metafile) {
  const roots = packageRoots(metafile);
  const split = SINGLE_COPY.filter((name) => (roots.get(name)?.size ?? 0) > 1);
  if (split.length === 0) return;

  const detail = split
    .map((name) => `  ${name}\n${[...roots.get(name)].map((r) => `    - ${r}`).join('\n')}`)
    .join('\n');
  throw new Error(
    `${label}: more than one copy of a package that must have exactly one.\n${detail}\n\n` +
      'Two copies split a realm silently — see the note above SINGLE_COPY in ' +
      'scripts/single-copy.mjs. Converge the pins across this repo and ' +
      '@shipstatic/mcp, then reinstall.',
  );
}
