# CLAUDE.md

Claude Code instructions for the **ShipStatic VS Code Extension**.

**shipstatic** — VS Code extension that registers the ShipStatic MCP server as a VS Code MCP provider, making all 15 tools available in agent mode. Also provides deploy, whoami, and token commands. Published to the VS Code Marketplace and Open VSX. **Maturity:** v1.0.x — MCP provider + basic commands.

**The version says which platform it speaks to: the 1.x extension is the one that speaks to the 2.x platform** — the same law the MCP established. It is a true major for this extension's own users, on three axes: the command id changed (`shipstatic.setApiKey` → `shipstatic.setToken`, and command ids are user-visible through keybindings), the credential vocabulary changed (`SHIP_API_KEY` → `SHIP_TOKEN`, one slot taking any platform token), and the bundled MCP's delete tools were renamed (`*_remove` → `*_delete`), so a saved agent workflow naming the old tool stops resolving.

It was also a REPAIR, not a refresh. `0.2.10` pinned `@shipstatic/ship@^0.9.6`, whose "anonymous" deploy mints an agent token through `POST /tokens/agent` — an endpoint the 2.x API deleted. Keyless deploy, the headline feature, was already broken against dev and would break against production at the cutover.

## Architecture

```
src/
├── extension.ts      # activate/deactivate — migrates, then wires everything
├── mcp.ts            # MCP server definition provider (the core feature)
├── auth.ts           # credential storage via VS Code SecretStorage
├── commands.ts       # Command palette: deploy, setToken, whoami
├── status-bar.ts     # Deploy button in status bar
└── mcp-entry.ts      # THE BUNDLED SERVER's entry — a child process, not the host
```

**Two esbuild entry points, and since 1.0.0 both are OUR source:**

```
esbuild (build time)
├── src/extension.ts   → dist/extension.js    (VS Code extension host, CJS)
└── src/mcp-entry.ts   → dist/mcp-server.js   (stdio child process, CJS)
```

## Core Patterns

### The bundle is a library CONSUMER, not a patched copy

Read this before touching `esbuild.mjs`. It is the class of change a future
session would reintroduce while "cleaning up" a manifest read.

Until 1.0.0 there was no `mcp-entry.ts`. `esbuild.mjs` bundled
`require.resolve('@shipstatic/mcp')` — the package **main** — and then reached
into the result with two `onLoad` plugins:

- one regex-stripped a shebang from the mcp's compiled `dist/index.js`;
- one regex-**rewrote a specific source line** inside the mcp's compiled
  `dist/server.js` — `const { version } = createRequire(import.meta.url)('../package.json')`
  — replacing it with a version literal.

Three coordination-by-regex hacks against another package's build output, and
the 1.x library split broke every one of them: `main` became the deliberately
**inert library** (`dist/index.js`), the runnable process moved to
`dist/bin.js`, the shebang moved with it, and the version became a PARAMETER of
`createServer`. A naive pin bump would have built green and shipped a `.vsix`
whose MCP server starts and does nothing. **A regex that stops matching does not
fail a build. It ships.**

The fix was not better patches. `@shipstatic/mcp` now exports `createServer` —
its `index.ts` records the widened rule, "what a second CONSUMER needs" — and
this repo writes its own ~20-line entry point composing it with a
`StdioServerTransport`. esbuild bundles a static import graph: no bin
resolution, no shebang, no regex, and `serverInfo.version` is the pin's by
construction, substituted by an esbuild `define` read from
`@shipstatic/mcp/package.json` at build time (the version-from-pin law the
hosted worker also uses).

Two consequences worth knowing:

- **`@modelcontextprotocol/sdk` is a direct devDependency**, at the same range
  the mcp declares. The extension composes a stdio MCP server, so it depends on
  the MCP SDK — and matching ranges is what keeps pnpm resolving ONE copy, so
  esbuild bundles one module instance rather than handing `server.connect()` a
  transport from a different realm.
- **`tests/mcp-entry.test.ts` boots the built artifact** and asserts its
  identity and its catalogue. That fence is what makes the whole class
  impossible to reintroduce; it also refuses to run against a stale `dist/`,
  because certifying yesterday's bundle is the same failure wearing a different
  hat.

### MCP Provider — The Core Feature

The extension registers a `McpServerDefinitionProvider` via `vscode.lm.registerMcpServerDefinitionProvider()`. This is the VS Code 1.99+ API for auto-discovering MCP servers in agent mode.

**Two-phase lifecycle (dictated by VS Code API contract):**

1. `provideMcpServerDefinitions()` — Called **eagerly** by VS Code. Returns the server definition. **MUST NOT** require user interaction.
2. `resolveMcpServerDefinition()` — Called when the server is about to **start**. Reads the stored credential via `getToken()` (no prompt). The server always starts — it works without one, deploying to the public account with a claim URL.

### Credential Management

**One slot, any platform token.** Since ship 2.0 there is a single `token`
option carrying a `ship-` API key, a `deploy-` deploy token, or an opaque
bearer. The value's shape says what it is and the **server** classifies it, so
this extension never inspects what it holds — which is why a new credential
population will never require a release here. Boundary validation is delegated
to `validateToken()` from `@shipstatic/types`, so the rule lives in one place.

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
"anonymous" agent-mode deploys through env inheritance — contradicting the
listing's claimable-deploy promise — and an exported `SHIP_API_URL` would
redirect them. SecretStorage is the **sole** credential source. Per
`@shipstatic/ship` "strict-isolation contract for embedded hosts", scrubbing is
the host's responsibility, not the SDK's.

**The list shrank from three to two at 1.0.0 because the SDK's env contract
did.** `SHIP_API_KEY` and `SHIP_DEPLOY_TOKEN` are read by nothing in the
one-credential world, and nulling a variable nobody reads is noise that reads
like protection. `tests/mcp.test.ts` asserts the block by exact equality, so an
SDK that grows a third variable must be met here.

**The extension host is deliberately NOT scrubbed, and that asymmetry is
recorded rather than overlooked.** The commands run in VS Code's extension host,
a process shared with every other installed extension, whose environment VS Code
resolves from the user's login shell. Deleting `SHIP_TOKEN` from it would mutate
shared state on other extensions' behalf. So a developer with a shell credential
and no stored one gets an authenticated deploy from the Deploy command — and
*sees* it, because every sentence the command writes is composed from the
RESPONSE: `result.claim` is present only when the API actually treated the
request as anonymous, so the notification cannot claim an expiry the deployment
does not have. The agent path has no such feedback loop, which is exactly why
the child process is the one that gets the scrub.

**Every path that stores a credential goes through `promptForToken()`** in
`commands.ts`, which fires `onDidChangeMcpServers` so VS Code re-queries the
provider. Three call sites used to fire it by hand, and forgetting is silent —
the agent simply keeps deploying anonymously after the user sets a token.

**The 0.2.x secret is migrated, once, on activation.** `migrateSecret()` moves
`shipstatic.apiKey` → `shipstatic.token` and deletes the old key. The
clean-break law governs API surface, not a credential the user already stored: a
rename they never asked for must not log them out. `activate` is **async for
this reason and this reason only** — VS Code queries the MCP provider as soon as
the extension is active, so a migration racing that would hand the agent an
anonymous server while a perfectly good token sat one key over.
`tests/extension.test.ts` fences the ordering by call order.

### SDK Wrapper — No Business Logic

Commands delegate directly to `@shipstatic/ship` SDK methods. No HTTP calls, no
validation beyond what the SDK provides. There is exactly **one** construction
expression, `new Ship({ token })`: an absent credential is not a second case,
because anonymity is the ABSENCE of one — the request simply carries no
`Authorization` header and the API grants the public-account identity per
request, answering with a claim URL and an expiry. The 0.9.6 code had a ternary
because its anonymity was a round trip.

Deployment tracking uses `via: 'vsc'` — a member of `DeploymentVia` in
`@shipstatic/types`, and since this repo pins types directly it is now the
compiler's job rather than a lockstep anyone has to remember.

**Durations are derived, never written.** `PUBLIC_EXPIRY` in `commands.ts`
comes from `PUBLIC_DEPLOYMENT_TTL_SECONDS` in `@shipstatic/types`, and
`tests/docs-contract.test.ts` holds the README to that same value — so a TTL
change cannot leave a sentence behind on the Marketplace.

## Quick Reference

```bash
pnpm install        # Install dependencies
pnpm build          # Build both entry points → dist/
pnpm test --run     # All tests (needs a current `pnpm build` — see below)
pnpm typecheck      # tsc over src AND tests, 0 errors
pnpm lint           # biome, 0 errors
pnpm coverage       # the suite plus the ratchet — what CI runs
pnpm watch          # Watch mode (no minification)
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
├── mcp-entry.test.ts       # fence: the BUILT bundle boots and is the pinned server
└── docs-contract.test.ts   # fence: the published listing tracks the extension
```

The `vscode` module is not installable — it exists only inside the editor — so
the vitest `alias` is not a convenience, it is the only thing that makes this
code testable. Named exports in `vscode.mock.ts` map 1:1 to the real namespace.
`@shipstatic/ship` is mocked with `vi.mock()` in the command tests;
`@shipstatic/types` deliberately is **not** — its constants and validators are
pure values, and asserting against a fake copy of them would assert against the
test's own data.

**`pnpm test` does not build, and one file needs the build.**
`tests/mcp-entry.test.ts` executes `dist/mcp-server.js` and refuses to run
against a missing or stale one, naming the fix. CI therefore runs `pnpm build`
BEFORE the suite, so an unbuilt tree fails rather than skipping the only fence
that proves the bundled server starts at all.

**`tests/**` is typechecked.** `pnpm typecheck` runs `tsc --noEmit` over `src`
and `tests` together. Load-bearing: vitest transpiles through esbuild WITHOUT
checking types, and under that gap the SDK mock in `commands.test.ts` kept
declaring `apiKey`, `API_KEY` and `validateApiKey` — names ship 2.0 does not
export — while the suite stayed green.

**Deviation from the platform sibling: there is ONE tsconfig, not two.**
`npm/ship` and `integrations/mcp` keep a build-shaped `tsconfig.json` that `tsc`
emits from, which is what forces a separate `tsconfig.check.json`. Nothing here
is built by `tsc` — esbuild produces both bundles and reads no tsconfig — so a
second file would have nothing to differ about.

| Fence | Catches |
|---|---|
| `mcp-entry.test.ts` | The bundle not being a working server, or not being the pinned one. The whole F1 class above, plus a stale `dist/` certifying itself. |
| `docs-contract.test.ts` | Drift between the Marketplace listing and the extension: a command title the manifest does not contribute, a tool count the bundled MCP does not serve, retired credential vocabulary, a duration that is not the derived expiry. |
| `extension.test.ts` ordering assertion | The migration racing the provider registration — the one bug that would present as "my token stopped working in agent mode". |
| `coverage.thresholds` | Coverage decay. 100 on statements/functions/lines; branches sits at 97 for one named arm (see `vitest.config.ts`). |

**BOLD is the marker in the README**, and it therefore belongs only to a live
command — the upgrade note names the retired *Set API Key* in italics for
exactly that reason.

## Publishing

Published to both marketplaces under the `shipstatic` publisher:

- **VS Code Marketplace:** https://marketplace.visualstudio.com/manage/publishers/shipstatic
- **Open VSX:** https://open-vsx.org/extension/shipstatic/shipstatic

**Releases are TAG-driven**: pushing `development` publishes nothing; pushing a
`v*` tag runs `release.yml`. `ci.yml` is the tests-only gate on both branches
(added at 1.0.0 — before that the tag workflow was the only automated gate, so a
broken commit was discovered at release time).

### The publish law, translated

`release.yml` carries the platform's npm publish law (root `CLAUDE.md`) with
every mechanism replaced, because not one of them exists here — no dist-tags, no
semver prereleases, no trusted publishing, and a tag rather than a branch as the
trigger. The header of that file holds the full mapping; the load-bearing parts:

- **The version picks the channel — via the MINOR's parity.** The Marketplace
  forbids semver prereleases (plain `major.minor.patch` only); its convention is
  odd minor = pre-release, even minor = stable. `1.0.0` is stable; a rehearsal
  release is `1.1.x`. Derived from the manifest, never hand-picked, and a
  non-conforming version fails before anything is packaged.
- **The tag grants the right, so the tag and the manifest must agree.** Asserted
  first. Nothing checked this before 1.0.0: tagging `v1.0.0` on a `0.2.10` tree
  published 0.2.10 under a `v1.0.0` GitHub Release.
- **Publishes are idempotent.** Each registry is queried for the version first
  and skipped with a `::notice`. An UNKNOWN answer means publish, never skip — a
  failed query must not silently cancel a release.
- **A skip says so.** The old `if: env.VSCE_PAT != ''` guards read a step's own
  `env:` block, which a step's `if:` cannot see — so **both publishes were
  skipping on every run**, silently, and a release that published nothing looked
  green. The variables are job-level now and every skip is a notice.
- **Credential posture.** There is no trusted-publishing equivalent, so the
  nearest thing is scope: `VSCE_PAT` / `OVSX_PAT` live only in the
  `marketplace` GitHub environment, whose deployment policy admits only `v*`
  tags. A repo-level secret is reachable by any workflow without declaring an
  environment, which is what makes the scoping load-bearing rather than tidy.
  This repo establishes the pattern root `CLAUDE.md` records as the open
  follow-up for tag-released repos.
- **No provenance equivalent.** The artifact trail is the `.vsix` attached to
  the GitHub Release — a user can compare it against what the Marketplace served.

**`.vscodeignore` is an allowlist** (`**` then `!` the six files that ship). It
was a denylist until 1.0.0 and a denylist only excludes what someone thought of;
by then it was shipping the coverage HTML report, the pre-commit hook,
`biome.jsonc`, `renovate.json` and `AGENTS.md` into the Marketplace artifact.
`pnpm exec vsce ls` is the check.

```bash
git tag v1.0.0 && git push origin v1.0.0   # the whole release
```

## Key Constraints

- **The engines floor is PROVEN, and the types pin IS the floor.**
  `engines.vscode` states the minimum; `@types/vscode` is pinned **exactly** to
  that minimum, with no caret, so `tsc` refuses any API the floor does not
  have. A floated types pin certifies the code against APIs the floor lacks —
  which is precisely how the floor was wrong from 0.2.x until 2026-08-06.

  It read `^1.99.0` while `vscode.lm.registerMcpServerDefinitionProvider` and
  `McpStdioServerDefinition` do not exist in the stable API until **1.101.0**
  (bisected against `@types/vscode` on npm: absent through 1.100.0, present
  from 1.101.0, and the `McpStdioServerDefinition` declaration is byte-identical
  from there to 1.110). On 1.99 or 1.100 the API is `undefined`, `activate()`
  throws, and the WHOLE extension bricks — commands and status bar included —
  for exactly the users the Marketplace told it was compatible. The floated
  `^1.99.0` types pin resolved to 1.110.0, so nothing could see it.

  When raising the floor, raise BOTH and re-run `pnpm typecheck` — it is the
  check. `tests/docs-contract.test.ts` holds the README's stated minimum to
  `engines` so the listing cannot drift from the manifest.
- **`process.execPath`** — Uses VS Code's bundled Node.js to spawn the MCP server, not `'node'` from PATH
- **The bundled-MCP design is deliberate** — the server is frozen into the `.vsix` at build time, so this extension never resolves npm's `latest` at runtime. That is why it was exempt from the MCP `latest`-flip choreography, and why its release is its own. An extension that ran `npx` would resolve `latest` and break that choreography.
- **No API-URL setting** — `contributes.configuration` is empty and published artifacts are prod-branded by law, so every installed copy talks to production. For dev verification, `SHIP_API_URL` in the Extension Development Host's launch environment reaches the SDK (the extension never ships it); the bundled MCP child cannot be redirected that way by design, so drive `dist/mcp-server.js` directly to verify it against another environment.
- **All deps are devDependencies** — Everything is bundled by esbuild; no runtime `node_modules`

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
