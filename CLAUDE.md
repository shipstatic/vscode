# CLAUDE.md

Claude Code instructions for the **ShipStatic VS Code Extension**.

**shipstatic** — VS Code extension that registers the ShipStatic MCP server as a VS Code MCP provider, making all 15 tools available in agent mode. Also provides deploy, whoami, and API key commands. Published to the VS Code Marketplace. **Maturity:** v0.2.x — MCP provider + basic commands.

## Architecture

```
src/
├── extension.ts      # activate/deactivate — wires everything
├── mcp.ts            # MCP server definition provider (the core feature)
├── auth.ts           # API key management via VS Code SecretStorage
├── commands.ts       # Command palette: deploy, setApiKey, whoami
└── status-bar.ts     # Deploy button in status bar
```

**Dual esbuild entry points:**

```
esbuild (build time)
├── src/extension.ts           → dist/extension.js      (VS Code extension host, CJS)
└── @shipstatic/mcp entry      → dist/mcp-server.js     (standalone bundle, child process)
```

`dist/mcp-server.js` is `@shipstatic/mcp` bundled with all its dependencies by esbuild at build time. Zero modifications to the MCP package — esbuild reads its entry point directly. VS Code spawns it as a stdio child process.

## Quick Reference

```bash
pnpm install        # Install dependencies
pnpm build          # Build both entry points → dist/
pnpm test --run     # All tests (32 tests, ~350ms)
pnpm watch          # Watch mode (no minification)
```

## Core Patterns

### MCP Provider — The Core Feature

The extension registers a `McpServerDefinitionProvider` via `vscode.lm.registerMcpServerDefinitionProvider()`. This is the VS Code 1.99+ API for auto-discovering MCP servers in agent mode.

**Two-phase lifecycle (dictated by VS Code API contract):**

1. `provideMcpServerDefinitions()` — Called **eagerly** by VS Code. Returns the server definition. **MUST NOT** require user interaction.
2. `resolveMcpServerDefinition()` — Called when the server is about to **start**. Reads stored API key via `getApiKey()` (no prompt). Sets `SHIP_API_KEY` env var if available. Server always starts — works without a key for claimable deployments.

### Credential Management

API key stored in VS Code's `SecretStorage` (OS keychain, encrypted). Never in `settings.json`. Passed to MCP server child process via `SHIP_API_KEY` env var — exactly what `@shipstatic/mcp` expects.

Every path that stores a new key fires `onDidChangeMcpServerDefinitions` so VS Code re-queries the provider: `setApiKey` command, deploy's "Set API Key" action, and whoami's key prompt.

### SDK Wrapper — No Business Logic

Commands delegate directly to `@shipstatic/ship` SDK methods. No HTTP calls, no validation beyond what the SDK provides. Deployment tracking uses `via: 'vscode'`.

### MCP Server Bundling

`@shipstatic/mcp` is a **devDependency** — used at build time only. esbuild directly takes its entry point (`dist/index.js`) and bundles everything (Ship SDK, MCP SDK, zod) into a single `dist/mcp-server.js`. A `strip-shebang` plugin removes the CLI shebang since VS Code spawns with `process.execPath`.

The `.vsix` ships `dist/extension.js` + `dist/mcp-server.js` + metadata. No `node_modules` at runtime.

## Testing

```
tests/
├── vscode.mock.ts       # vscode module mock (alias in vitest.config.ts)
├── auth.test.ts         # SecretStorage flows (5 tests)
├── mcp.test.ts          # Provider registration + resolve lifecycle (8 tests)
├── commands.test.ts     # All 3 commands + SDK arg verification (16 tests)
└── status-bar.test.ts   # Item properties + disposal (3 tests)
```

The `vscode` module is mocked via vitest's `alias` config — named exports in `vscode.mock.ts` map 1:1 to the real `vscode` namespace. `@shipstatic/ship` is mocked with `vi.mock()` in command tests.

## Publishing

Published to the VS Code Marketplace under the `shipstatic` publisher.

```bash
pnpm package         # Build .vsix locally
pnpm publish         # Publish to marketplace (requires VSCE_PAT)
```

## Key Constraints

- **Minimum VS Code 1.99** — `vscode.lm.registerMcpServerDefinitionProvider` API
- **`process.execPath`** — Uses VS Code's bundled Node.js to spawn the MCP server, not `'node'` from PATH
- **Zero changes to `@shipstatic/mcp`** — The MCP server is bundled as-is
- **All deps are devDependencies** — Everything is bundled by esbuild; no runtime `node_modules`

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
