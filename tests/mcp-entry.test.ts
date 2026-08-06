import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_TOOL_NAMES, SERVER_NAME, UPLOAD_TOOL_NAME } from '@shipstatic/mcp';
import mcpManifest from '@shipstatic/mcp/package.json';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../package.json';

/**
 * @file Fence: THE BUNDLE BOOTS, and it is the server we pinned.
 *
 * This is the one test that runs `dist/mcp-server.js` — the artifact VS Code
 * actually spawns — and it exists because the failure it catches is silent by
 * construction. Until 1.0.0 the build reached into `@shipstatic/mcp`'s compiled
 * output with regexes: one stripped a shebang, one rewrote a version line
 * inside `dist/server.js`. A regex that stops matching does not fail the build.
 * It ships. The 1.x library split moved the runnable entry from `main` to `bin`
 * and turned the version into a parameter, so a naive pin bump would have
 * produced a green build and a `.vsix` whose MCP server starts and does nothing.
 *
 * The assertions pin each half of that story: the process comes up and
 * completes an `initialize`; it identifies as the pinned package rather than as
 * whatever a failed substitution left behind; and it serves the whole catalogue
 * rather than an empty one. No network is involved — `initialize` and
 * `tools/list` are answered entirely in process, and the catalogue is static by
 * design (identity decides what SUCCEEDS, not what EXISTS).
 *
 * Recorded artifact-tier note: this file consumes production code in BUILT
 * form, so it executes `dist/`, not `src/`. That IS its subject.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(ROOT, 'dist/mcp-server.js');

/**
 * Fifteen — the one anonymous upload tool plus the fourteen account-tied ones.
 * Derived from the pinned package's own exports rather than counted here, so a
 * release that adds a tool moves this number without anyone editing it.
 */
const CATALOGUE = [UPLOAD_TOOL_NAME, ...ACCOUNT_TOOL_NAMES];

// =============================================================================
// FRESHNESS GUARD
// =============================================================================
// `pnpm test` does not build. Without this, a local run certifies yesterday's
// bundle while every other file tests today's source — which is the precise
// shape of the bug this fence exists to catch.

function newestMtimeMs(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) {
    newest = Math.max(newest, newestMtimeMs(join(path, entry)));
  }
  return newest;
}

function assertFreshBundle(): void {
  if (!existsSync(BUNDLE)) {
    throw new Error(`missing bundle — run \`pnpm build\` (expected ${BUNDLE})`);
  }
  const builtAt = statSync(BUNDLE).mtimeMs;
  // Every input that decides this file's contents: our source, the bundler
  // config, and the resolved dependency graph.
  //
  // The lockfile is the one that is easy to leave out and the one that matters
  // most. A `@shipstatic/mcp` bump without a rebuild is caught downstream
  // anyway — the version assertion compares the running server against the
  // installed manifest — but that is the ONLY pin it catches. Bump
  // `@shipstatic/ship`, `@shipstatic/types` or the MCP SDK, skip the build, and
  // every assertion below still passes against a bundle carrying the old
  // dependency. Nothing else in this suite can see that, because nothing else
  // runs the artifact.
  const sourcedAt = Math.max(
    newestMtimeMs(join(ROOT, 'src')),
    newestMtimeMs(join(ROOT, 'esbuild.mjs')),
    newestMtimeMs(join(ROOT, 'pnpm-lock.yaml')),
  );
  if (sourcedAt > builtAt) {
    throw new Error(
      'stale bundle — run `pnpm build`. This file executes dist/mcp-server.js, ' +
        'and its inputs have changed since it was built, so the run would ' +
        'certify a bundle that no longer matches the source.',
    );
  }
}

// =============================================================================
// A MINIMAL STDIO CLIENT
// =============================================================================
// The stdio transport is newline-delimited JSON-RPC on stdin/stdout, so a child
// process is drivable without an MCP client library. The server writes its
// banner to STDERR by design; keeping the streams apart is load-bearing, since
// a merged read corrupts the first JSON-RPC parse.

class StdioClient {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private proc: ReturnType<typeof spawn>;
  stderr = '';

  constructor() {
    this.proc = spawn(process.execPath, [BUNDLE], {
      cwd: ROOT,
      // An allowlist, not a scrub: a developer's exported SHIP_TOKEN would
      // otherwise authenticate a server this file drives as anonymous.
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    createInterface({ input: this.proc.stdout! }).on('line', (line) => {
      if (!line.trim()) return;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      this.settle(message.id, (entry) => entry.resolve(message));
    });

    this.proc.stderr!.on('data', (chunk) => {
      this.stderr += String(chunk);
    });

    this.proc.on('exit', (code, signal) => {
      // A child that dies mid-call must fail loudly and NOW; waiting out the
      // timeout would report "slow" instead of "dead", with the cause on a
      // stream nobody read.
      for (const id of [...this.pending.keys()]) {
        this.settle(id, (entry) =>
          entry.reject(
            new Error(
              `server exited early (code ${code}, signal ${signal}) — stderr: ${this.stderr.trim()}`,
            ),
          ),
        );
      }
    });
  }

  private settle(id: number, apply: (entry: { resolve: any; reject: any }) => void): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    apply(entry);
  }

  send(method: string, params?: unknown): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  kill(): void {
    this.proc.kill();
  }
}

describe('the bundled MCP server', () => {
  let client: StdioClient;
  let initialize: any;

  beforeAll(async () => {
    assertFreshBundle();
    client = new StdioClient();
    initialize = (
      await client.send('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vscode-bundle-fence', version: '1' },
      })
    ).result;
    client.notify('notifications/initialized');
  }, 20_000);

  afterAll(() => client?.kill());

  it('comes up and completes the handshake', () => {
    // The whole F1 class in three lines: a bundle whose entry point resolves
    // to an inert library answers nothing here and prints no banner.
    expect(initialize).toBeDefined();
    expect(initialize.protocolVersion).toBeTruthy();
    expect(client.stderr).toContain('running on stdio');
  });

  it('identifies as the pinned package, by construction', () => {
    expect(initialize.serverInfo.name).toBe(SERVER_NAME);
    // Not "some version": the one the build inlined from the pin's own
    // manifest. A substitution that silently failed to apply lands here.
    expect(initialize.serverInfo.version).toBe(mcpManifest.version);
  });

  it('carries the one-credential instructions an agent reads before acting', () => {
    expect(initialize.instructions).toContain('SHIP_TOKEN');
    expect(initialize.instructions).not.toContain('SHIP_API_KEY');
  });

  it('serves the whole catalogue, under the 1.x names', async () => {
    const { result } = await client.send('tools/list', {});
    const names: string[] = result.tools.map((t: any) => t.name);

    expect(names.sort()).toEqual([...CATALOGUE].sort());
    // The 1.x rename, asserted where a saved agent workflow would feel it.
    expect(names).not.toContain('deployments_remove');
    expect(names).not.toContain('domains_remove');
  });
});

describe('the manifest', () => {
  it('pins @shipstatic/mcp exactly, so what ships is a decision', () => {
    // A range would let `pnpm install` change the bundled server without a
    // diff — and the version the server reports is read from whatever got
    // installed, so the two would still agree while both were wrong.
    expect(manifest.devDependencies['@shipstatic/mcp']).toBe(mcpManifest.version);
  });
});
