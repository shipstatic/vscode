# Changelog

## 1.0.2 (2026-09-02)

- Listing copy follows the platform canon (heading case). No functional change.

## 1.0.1 (2026-09-01)

- The listing speaks the platform's one voice: the root sentence, the family
  table of every other way to ship, and this changelog (the Marketplace
  renders it as its own tab).
- Categories: AI and Chat.
- No functional change from 1.0.0.

## 1.0.0 (2026-09-01)

The 1.x extension speaks the 2.x ShipStatic platform. Upgrading from 0.2.x is
a break in one place: the credential.

- **One credential slot.** `shipstatic.setToken` stores a single token in
  SecretStorage, and it takes either platform population: a `ship-` API key or
  a `deploy-` deploy token. A value saved by 0.2.x under the old key is
  migrated silently on first run.
- **All fifteen ShipStatic tools in agent mode**, contributed through VS Code's
  MCP provider API: deploy a folder, then list, inspect, label and delete
  deployments, and set up custom domains end to end.
- **Deploys are attributed to the editor** (`via: vsc`) rather than to a
  generic MCP host.
- **The bundled server is composed, not patched.** The extension builds its
  stdio entry from `@shipstatic/mcp`'s exported `createServer`, so a version
  bump can no longer produce a server that starts and does nothing.
- **Requires VS Code 1.101 or later**, where
  `vscode.lm.registerMcpServerDefinitionProvider` was finalized. The floor is
  measured rather than assumed, and the suite runs a real editor at it.
- The published artifact is an allowlist: manifest, listing, licence, icon and
  the two bundles, and nothing else.

## 0.2.10 (2026-05-05)

Last of the 0.2.x line, which spoke the 1.x platform. Superseded by 1.0.0.
