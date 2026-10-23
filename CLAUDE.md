# CLAUDE.md

Claude Code instructions for the **ShipStatic VS Code Extension**.

**shipstatic** is a VS Code extension that registers the ShipStatic MCP server as a VS Code MCP provider, so all 15 tools are available in agent mode. It also provides deploy, whoami and token commands. Published to the VS Code Marketplace and Open VSX. **Maturity:** v1.0.x, MCP provider plus basic commands.

**The version says which platform it speaks to.** The 1.x extension speaks the current 3.x platform through its exact pins of `@shipstatic/ship`, `@shipstatic/types` and `@shipstatic/mcp`. A major here is a break for this extension's own users: a command id (user-visible through keybindings), the credential vocabulary, or a bundled tool name.

## Architecture

```
src/
├── extension.ts      # activate/deactivate: migrates, then wires everything
├── mcp.ts            # MCP server definition provider (the core feature)
├── auth.ts           # credential storage via VS Code SecretStorage
├── commands.ts       # Command palette: deploy, setToken, whoami
├── status-bar.ts     # Deploy button in status bar
└── mcp-entry.ts      # THE BUNDLED SERVER's entry: a child process, not the host

scripts/
└── bundle-integrity.mjs  # the build's bundle fences: single-copy + absence
```

**Two esbuild entry points, and both are our source:**

```
esbuild (build time)
├── src/extension.ts   → dist/extension.js    (VS Code extension host, CJS)
└── src/mcp-entry.ts   → dist/mcp-server.js   (stdio child process, CJS)
```

## Core Patterns

### The bundle is a library CONSUMER, not a patched copy

Read this before touching `esbuild.mjs`.

`@shipstatic/mcp` exports `createServer`, and `src/mcp-entry.ts` composes it
with a `StdioServerTransport`. esbuild bundles a static import graph: no bin
resolution, no shebang, no regex over another package's build output.
`serverInfo.version` is the pin's by construction, substituted by an esbuild
`define` read from `@shipstatic/mcp/package.json` at build time.

**Never reach into the mcp's compiled `dist/` with an `onLoad` patch.** A
regex that stops matching does not fail a build. It ships, and the `.vsix`
carries a server that starts and does nothing.

**It passes `via: 'vsc'`.** `via` names the DISTRIBUTION SURFACE, not the
protocol: this server ships inside the `.vsix`, so its deploys are the
extension's, and `mcp` would make them indistinguishable from an npx install
in another client.

**A `startStdio` export absorbing the transport is refused.** The MCP SDK's
`server/stdio.js` imports `node:process`, so the package's library entry
cannot export it without putting a Node builtin in the graph the hosted
transport loads; the mcp repo's `CLAUDE.md` owns the refusal.

**`@modelcontextprotocol/sdk` is a direct devDependency, at the same range
the mcp declares**, so pnpm resolves ONE copy and `server.connect()` never
receives a transport from another realm. `isShipError` is STRUCTURAL rather
than `instanceof`, so a split realm degrades quietly instead of throwing:
`scripts/bundle-integrity.mjs` fences it on every build (it lives in
`scripts/` so `tests/bundle-integrity.test.ts` can watch it FAIL), and
`tests/mcp-entry.test.ts` boots the built artifact (see the fence table).

### MCP Provider: The Core Feature

The extension registers a `McpServerDefinitionProvider` via `vscode.lm.registerMcpServerDefinitionProvider()`, the API for auto-discovering MCP servers in agent mode, finalized in **1.101** (the engines floor, see Key Constraints).

**Two-phase lifecycle (the VS Code API contract):**

1. `provideMcpServerDefinitions()` is called **eagerly** by VS Code and returns the server definition. It **MUST NOT** require user interaction.
2. `resolveMcpServerDefinition()` is called when the server is about to **start**. It reads the stored credential via `getToken()` (no prompt). The server always starts: without a credential it deploys to the public account with a claim URL.

### Credential Management

**One slot, any platform token.** The single `token` option carries a `ship-`
API key, a `deploy-` deploy token, or an opaque bearer. The **server**
classifies it, so this extension never inspects what it holds and a new
credential population never needs a release here. Boundary validation is
`validateToken()` from `@shipstatic/types`.

Stored in VS Code's `SecretStorage` (OS keychain, encrypted) under
`shipstatic.token`. Never in `settings.json`.

**Strict env isolation.** `resolveMcpServerDefinition` states the child's whole
`SHIP_*` environment:

```ts
server.env = {
  SHIP_TOKEN: token ?? null,
  SHIP_API_URL: null,
};
```

Both of the SDK's documented variables, explicitly nulled. Without this, a
developer with `SHIP_TOKEN` exported for CLI use would silently authenticate
"anonymous" agent-mode deploys, and an exported `SHIP_API_URL` would redirect
them. SecretStorage is the **sole** credential source; scrubbing is the host's
job, not the SDK's (ship's "strict-isolation contract for embedded hosts").
`tests/mcp.test.ts` asserts the block by exact equality, so an SDK that grows a
third variable must be met here.

**The extension host is deliberately NOT scrubbed**: it is shared with every
other installed extension, and deleting `SHIP_TOKEN` there would mutate their
state. The Deploy command composes every sentence from the RESPONSE
(`result.claim` is present only when the API treated the request as
anonymous), so a shell credential's effect is visible there; the agent path
has no such feedback, which is why the child gets the scrub.

**Every path that stores a credential goes through `promptForToken()`** in
`commands.ts`, which fires `onDidChangeMcpServers` so VS Code re-queries the
provider. Forgetting it is silent: the agent keeps deploying anonymously after
the user sets a token.

**The 0.2.x secret is migrated, once, on activation.** `migrateSecret()` moves
`shipstatic.apiKey` to `shipstatic.token` and deletes the old key, because a
rename the user never asked for must not log them out. `activate` is **async
for this reason only**: VS Code queries the provider as soon as the extension
is active, and a migration racing that would hand the agent an anonymous
server. `tests/extension.test.ts` fences the ordering by call order.

### SDK Wrapper: No Business Logic

Commands delegate directly to `@shipstatic/ship` SDK methods: no HTTP calls,
no validation beyond the SDK's. There is exactly **one** construction
expression, `new Ship({ token })`. Anonymity is the ABSENCE of a credential:
the request carries no `Authorization` header and the API grants the
public-account identity, answering with a claim URL and an expiry.

Deployment tracking uses `via: 'vsc'`, a member of `DeploymentVia` in
`@shipstatic/types`, so the compiler holds it.

**Durations are quoted, never authored.** The palette's expiry phrase is
`PUBLIC_EXPIRY` from `@shipstatic/mcp`'s vocabulary, itself derived from
`PUBLIC_DEPLOYMENT_TTL_SECONDS` in `@shipstatic/types`. `tests/docs-contract.test.ts`
holds the README to the same phrase, so a TTL change cannot leave a sentence
behind on the Marketplace.

Importing from the mcp package into the EXTENSION-HOST bundle is safe for one
reason: the package's `sideEffects` field marks everything but its executable
inert, so esbuild drops the server graph and the host bundle gains vocabulary
constants, not an MCP SDK. The absence fence in `scripts/bundle-integrity.mjs`
notices if that stops being true.

## Quick Reference

```bash
pnpm install        # Install dependencies
pnpm build          # Build both entry points → dist/ (runs the realm fence)
pnpm test --run     # All tests (needs a current `pnpm build`, see below)
pnpm typecheck      # tsc over src AND tests, 0 errors
pnpm lint           # biome, 0 errors
pnpm coverage       # the suite plus the ratchet: what CI runs
pnpm test:host      # a REAL VS Code at the engines floor (~140MB, cached)
pnpm watch          # Watch mode (no minification, sourcemaps on)
pnpm package        # Build .vsix locally
```

## Testing

```
tests/
├── vscode.mock.ts          # the `vscode` module mock (alias in vitest.config.ts)
├── auth.test.ts            # SecretStorage, the one-slot validator, the migration
├── mcp.test.ts             # provider registration + resolve lifecycle + env block
├── commands.test.ts        # all 3 commands + SDK arg verification
├── extension.test.ts       # activation wiring + the migration's ORDERING
├── status-bar.test.ts      # item properties + disposal
├── bundle-integrity.test.ts # the build's bundle fences, watched FAILING
├── mcp-entry.test.ts       # fence: the BUILT bundle boots and is the pinned server
├── docs-contract.test.ts   # fence: the published listing tracks the extension
└── host/                   # `pnpm test:host`: a real editor at the floor
    ├── run.mjs             #   the launcher (downloads VS Code, derives the version)
    └── suite.cjs           #   what runs INSIDE the extension host
```

**Three tiers, and each says something the others cannot.**

| Tier | Runs | Says |
|---|---|---|
| mock (`pnpm test`) | in-process, against `tests/vscode.mock.ts` | behaviour: every command, every branch |
| artifact (`mcp-entry.test.ts`) | `dist/mcp-server.js` in a child process | the bundled server boots and is the pinned one |
| host (`pnpm test:host`) | a real VS Code at `engines.vscode` | the editor loads and activates the built extension |

- **The mock is a hand-written twin**, name-checked against `@types/vscode`
  (`satisfies Pick<…>` per namespace), so a rename turns `pnpm typecheck` red.
  Only the host tier meets an editor. The vitest `alias` is what makes this
  code testable (the `vscode` module exists only inside the editor).
- **`@shipstatic/ship` is mocked** with `vi.mock()` in the command tests;
  `@shipstatic/types` deliberately is **not**: a fake copy of pure values
  would assert against the test's own data.
- **`pnpm test` does not build**, and `mcp-entry.test.ts` refuses a missing or
  stale `dist/`, so CI runs `pnpm build` BEFORE the suite.
- **`tests/**` is typechecked** (`tsc --noEmit` over `src` and `tests`),
  because vitest transpiles WITHOUT checking types.
- **Deviation: ONE tsconfig, not two.** esbuild produces both bundles and
  reads no tsconfig, so the `tsconfig.check.json` split that `tsc`-emitting
  siblings need has nothing to differ about here.

| Fence | Catches |
|---|---|
| `mcp-entry.test.ts` | The bundle not being a working server, or not the pinned one, plus a stale `dist/` certifying itself: its freshness guard names `src/`, `esbuild.mjs` AND the lockfile, since a dependency bump without a rebuild is the same lie. |
| `scripts/bundle-integrity.mjs` (on build) | Two silent classes: a SPLIT REALM (two copies of `@shipstatic/types`, `@shipstatic/ship`, the MCP SDK or `zod` in one bundle) and a GRAPH LEAK (the MCP SDK in the extension-host bundle at all). |
| `pnpm test:host` | The contract with the EDITOR: the extension not loading, `activate()` throwing at the engines floor, a contributed command never registered. Nothing else loads the built `dist/extension.js`. |
| `docs-contract.test.ts` | Drift between the Marketplace listing and the extension: a command title the manifest does not contribute, a tool count the bundled MCP does not serve, retired credential vocabulary, a duration that is not the derived expiry, a stated minimum that is not `engines`. |
| `extension.test.ts` ordering assertion | The migration racing the provider registration ("my token stopped working in agent mode"). |
| `coverage.thresholds` | Coverage decay. 100 on statements/functions/lines; branches sits at 97 for one named arm (see `vitest.config.ts`). |

**BOLD is the marker in the README** and belongs only to a live command; the
upgrade note names the retired *Set API Key* in italics for that reason.

## Publishing

Published under the `shipstatic` publisher:

- **VS Code Marketplace:** https://marketplace.visualstudio.com/items?itemName=shipstatic.shipstatic
- **Open VSX:** https://open-vsx.org/extension/shipstatic/shipstatic

**Releases are TAG-driven**: pushing `development` publishes nothing; pushing a
`v*` tag runs `release.yml`. `ci.yml` is the tests-only gate on both branches.

```bash
git tag vX.Y.Z && git push origin vX.Y.Z   # the whole release; X.Y.Z is package.json's version
```

### The publish law, translated

This repo owns its translation of the platform's npm publish law. Every intent
carries over and no mechanism does: the Marketplace has no dist-tags, no semver
prereleases and no trusted publishing, and the trigger is a tag. The header of
`release.yml` holds the full mapping. The rules:

- **The version picks the channel, via the MINOR's parity.** The Marketplace
  allows plain `major.minor.patch` only; odd minor is pre-release, even minor
  is stable (`1.0.x` stable, a rehearsal `1.1.x`). Derived from the manifest,
  never hand-picked; a non-conforming version fails before anything is
  packaged.
- **The tag grants the right, so the tag must equal `v` plus the manifest
  version.** Asserted first, so a tag on the wrong tree publishes nothing.
- **Publishes are idempotent.** Each storefront is queried for the version
  first and skipped with a `::notice`. An UNKNOWN answer means publish, never
  skip: a failed query must not silently cancel a release.
- **A skip says so.** The PAT variables are job-level, because a step's `if:`
  cannot see that step's own `env:` block, and a step-level guard would skip
  every run in silence.
- **One job, one credential.** `build` holds the OIDC grant (for the
  attestation) and runs first-party steps only; `release` holds
  `contents: write` alone; `marketplace` and `openvsx` each publish with their
  own PAT, so a failure names its storefront and "Re-run failed jobs" repairs
  that half.
- **Credential posture.** There is no trusted-publishing equivalent, so the
  nearest thing is scope: `VSCE_PAT` belongs in the `marketplace` environment
  and `OVSX_PAT` in `open-vsx`, each admitting only `v*` tags, and never at
  repo level, where any workflow can read a secret without declaring an
  environment. The header of `release.yml` states whether the values sit there
  yet; read it before trusting the scoping.
- **Provenance.** `actions/attest-build-provenance` signs the `.vsix` through
  GitHub's OIDC identity, the trust root `npm publish --provenance` uses, and a
  user verifies with `gh attestation verify`. It runs BEFORE the Release
  upload, so a Release never carries an unattested artifact.

**`.vscodeignore` is an allowlist** (`**`, then `!` for the seven files that
ship: the manifest, README, CHANGELOG, licence, icon and the two bundles). A
denylist only excludes what someone thought of. `pnpm exec vsce ls` is the
check.

## Key Constraints

- **The engines floor is PROVEN, and the types pin IS the floor.**
  `engines.vscode` states the minimum (`^1.101.0`); `@types/vscode` is pinned
  **exactly** to that minimum, with no caret, so `tsc` refuses any API the
  floor does not have. `vscode.lm.registerMcpServerDefinitionProvider` and
  `McpStdioServerDefinition` do not exist before 1.101.0; below it `activate()`
  throws and the whole extension bricks. When raising the floor, raise BOTH
  and re-run `pnpm typecheck`, which is the check. `tests/docs-contract.test.ts`
  holds the README's stated minimum to `engines`.
- **`process.execPath`**: the MCP server is spawned with VS Code's bundled
  Node.js, never `node` from PATH.
- **The bundled MCP is deliberate.** The server is frozen into the `.vsix` at
  build time, so this extension never resolves npm's `latest` at runtime and
  its release is its own. An extension that ran `npx` would.
- **No API-URL setting.** `contributes.configuration` is empty and published
  artifacts are prod-branded, so every installed copy talks to production. For
  verification against another environment, `SHIP_API_URL` in the Extension
  Development Host's launch environment reaches the SDK (the extension never
  ships it); the bundled child cannot be redirected that way by design, so
  drive `dist/mcp-server.js` directly.
- **All deps are devDependencies.** esbuild bundles everything; there is no
  runtime `node_modules`.
- **Declared posture.** `capabilities` in the manifest refuses virtual
  workspaces (deploying reads files from disk) and untrusted workspaces
  (deploying publishes the selected folder to a public URL).

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
