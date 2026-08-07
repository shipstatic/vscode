/**
 * Bundle integrity — the checks `esbuild.mjs` runs on every build, from the
 * build's own metafile. Two assertions, two failure classes:
 *
 *   - `assertSingleCopy` — a fenced package resolving TWICE inside one bundle
 *     (a split realm; silent by construction).
 *   - `assertAbsent` — a package appearing in a bundle that must not carry it
 *     at all (a graph leak; silent by size alone).
 *
 * Its own module rather than a closure inside the bundler config so the
 * behaviour is testable: `tests/bundle-integrity.test.ts` feeds both a
 * synthetic metafile and asserts they FIRE. A fence nobody has watched fail is
 * a fence nobody knows the shape of.
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

/**
 * The files that CONTRIBUTED BYTES to the emitted bundles.
 *
 * `metafile.inputs` is the wrong source and the difference is load-bearing:
 * it lists every module esbuild PARSED, including ones tree-shaking then
 * dropped — so a fence reading it calls a successfully-shaken graph a leak.
 * Caught live: with `sideEffects` doing its job the extension bundle carried
 * vocabulary constants only, and the absence fence still fired on SDK modules
 * that existed nowhere in the output. What ships is `outputs[].inputs`.
 */
function bundledFiles(metafile) {
  return Object.values(metafile.outputs ?? {}).flatMap((output) =>
    Object.keys(output.inputs ?? {}),
  );
}

/** Distinct installed roots per package name, among what was actually bundled. */
export function packageRoots(metafile) {
  const roots = new Map();
  for (const file of bundledFiles(metafile)) {
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
      'scripts/bundle-integrity.mjs. Converge the pins across this repo and ' +
      '@shipstatic/mcp, then reinstall.',
  );
}

/**
 * Packages the EXTENSION-HOST bundle must not contain.
 *
 * `dist/extension.js` imports `@shipstatic/mcp` for its vocabulary — the one
 * authored expiry phrase — and for nothing else; the MCP SDK belongs only to
 * `dist/mcp-server.js`, the child process that actually runs a server. The
 * library's `sideEffects` manifest field is what lets esbuild drop the unused
 * server graph, and this assertion is what notices when that stops working:
 * measured before the field existed, the host bundle silently grew +142KB of
 * SDK it could never call.
 */
export const ABSENT_FROM_EXTENSION = ['@modelcontextprotocol/sdk'];

/** @throws when a package that must be absent appears in the bundle at all. */
export function assertAbsent(label, metafile, names) {
  const roots = packageRoots(metafile);
  const present = names.filter((name) => roots.has(name));
  if (present.length === 0) return;

  throw new Error(
    `${label}: contains ${present.join(', ')}, which this bundle must not carry.\n\n` +
      'The extension host quotes vocabulary; only the child process runs a server. ' +
      'Usual cause: @shipstatic/mcp lost its sideEffects field, or a new import in ' +
      'src/ reaches the server graph — see ABSENT_FROM_EXTENSION in ' +
      'scripts/bundle-integrity.mjs.',
  );
}
