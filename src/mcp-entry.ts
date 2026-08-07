/**
 * THE BUNDLED MCP SERVER — `dist/mcp-server.js`, the file VS Code spawns as a
 * stdio child process. It is this extension's second entry point, and the only
 * one that is not the extension host.
 *
 * **This file exists so that the build never touches another package's bytes.**
 * Until 1.0.0 there was no entry point here: `esbuild.mjs` bundled
 * `require.resolve('@shipstatic/mcp')` and then reached into the result with two
 * onLoad plugins — one stripping a shebang, one REGEX-REWRITING a specific line
 * inside the mcp's compiled `dist/server.js` to inline a version literal. Three
 * coordination-by-regex hacks against a dependency's build output, and the 1.x
 * library split broke every one: the runnable entry moved from `main` to `bin`,
 * the shebang moved with it, and the version became a parameter. A naive pin
 * bump would have built green and shipped a server that starts and does nothing.
 *
 * The composition below is what those hacks were approximating, said directly.
 * `@shipstatic/mcp` exports `createServer` for exactly this consumer (see its
 * `src/index.ts` — "what a second CONSUMER needs"), esbuild bundles a static
 * import graph, and `serverInfo.version` is the pin's by construction rather
 * than by a regex that can silently fail to match. `tests/mcp-entry.test.ts`
 * boots the artifact and asserts both, so the class cannot come back.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@shipstatic/mcp';
import Ship from '@shipstatic/ship';
import { DeploymentVia, SHIP_ENV } from '@shipstatic/types';

/**
 * The pinned `@shipstatic/mcp` version, substituted by esbuild's `define` from
 * that package's own manifest at build time — the version-from-pin law, with no
 * manifest read at runtime. A library must not assume it has a manifest, which
 * is why `createServer` takes the version as an argument in the first place.
 */
declare const MCP_VERSION: string;

async function main() {
  // The credential arrives in the environment VS Code hands this child, which
  // `resolveMcpServerDefinition` builds from SecretStorage alone. It is
  // optional: without it, deployments go to the public account and answer with
  // a claim URL. One slot, any platform token — the server classifies it.
  const ship = new Ship({ token: process.env[SHIP_ENV.TOKEN] });
  // `via` names the DISTRIBUTION SURFACE, not the protocol — the GitHub Action
  // reports `git` whatever invoked the workflow. This server ships inside the
  // extension's `.vsix`, so its deploys are the extension's; the palette's
  // already said `vsc`, and until `@shipstatic/mcp@1.0.0-beta.8` the agent's
  // could only say `mcp`, indistinguishable from an npx install elsewhere.
  const server = createServer(ship, { version: MCP_VERSION, via: DeploymentVia.VSC });
  await server.connect(new StdioServerTransport());

  // stdout is the JSON-RPC channel, so the banner goes to stderr — where VS
  // Code shows it in the server's output view. A server that prints nothing on
  // start is indistinguishable from one that started and does nothing, which
  // is precisely the failure this file exists to make impossible.
  console.error('ShipStatic MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
