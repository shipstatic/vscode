import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_TOOL_NAMES } from '@shipstatic/mcp';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json';
import { PUBLIC_EXPIRY } from '../src/commands';

/**
 * @file Fence: the PUBLISHED listing tracks the extension.
 *
 * `README.md` is what renders on the VS Code Marketplace and Open VSX. For
 * someone deciding whether to install, it IS the product description — and
 * nothing else checks it. The platform has paid for this exact gap twice: the
 * 2026-07 `remove` → `delete` rename swept every source file and test while the
 * published `SKILL.md` kept teaching three commands that no longer existed, and
 * the MCP's own README needed a fence for the same reason. Every fence of those
 * waves fenced code.
 *
 * Deliberately narrow. Prose is free; the fence holds only the facts the
 * listing RESTATES from somewhere else — the command titles, the tool count,
 * the public expiry, and the credential vocabulary.
 */

const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

describe('README', () => {
  it('names exactly the commands the manifest contributes', () => {
    // Every command the palette offers must be documented, and the listing must
    // not promise one the manifest does not register. BOLD is the marker, and
    // it therefore belongs only to a live command — the upgrade note names the
    // retired `Set API Key` in italics for exactly this reason.
    const documented = [...README.matchAll(/\*\*(ShipStatic: [^*]+)\*\*/g)].map((m) => m[1]).sort();
    const contributed = manifest.contributes.commands.map((c) => c.title).sort();

    expect([...new Set(documented)]).toEqual(contributed);
  });

  it('states the tool count the pinned MCP actually serves', () => {
    // The upload tool plus the fourteen account-tied ones — read from the
    // package that is bundled, never counted by hand in a second repo.
    const claimed = README.match(/adds (\d+) ShipStatic tools/);

    expect(claimed).not.toBeNull();
    expect(Number(claimed?.[1])).toBe(1 + ACCOUNT_TOOL_NAMES.length);
  });

  it('states the editor minimum the manifest actually declares', () => {
    // The floor is one fact with three statements — `engines.vscode`, the
    // exact `@types/vscode` pin that makes tsc enforce it, and this sentence.
    // Only the listing is unenforceable by a compiler, so it gets a fence.
    // It read "1.99 or later" from 0.2.x until 2026-08-06, against an API that
    // does not exist below 1.101: the Marketplace was telling users the
    // extension would work on editors where `activate()` throws.
    const floor = manifest.engines.vscode.replace(/^\^/, '');
    const [major, minor] = floor.split('.');

    expect(README).toContain(`VS Code ${major}.${minor} or later`);
  });

  it('speaks the one-credential vocabulary and nothing retired', () => {
    // The 1.0.0 break, stated where a user reads it. `SHIP_API_KEY` and
    // `SHIP_DEPLOY_TOKEN` are read by nothing since ship 2.0; a listing that
    // still teaches them teaches a setting that does nothing.
    expect(README).not.toMatch(/SHIP_API_KEY|SHIP_DEPLOY_TOKEN/);
    expect(README).toContain('SHIP_TOKEN');
  });

  it('states every duration as the one public expiry the notification uses', () => {
    // `PUBLIC_EXPIRY` is imported from `src/commands.ts`, which derives it from
    // `PUBLIC_DEPLOYMENT_TTL_SECONDS` in `@shipstatic/types`. So this reads the
    // shipping value rather than restating it, and a TTL change turns the
    // listing red until it follows. The hyphen form is refused outright: one
    // fact in two spellings is how one of them goes stale.
    const durations = README.match(/\b\d+ (?:day|hour)s?\b/g) ?? [];

    expect(durations.length).toBeGreaterThan(0);
    for (const duration of durations) expect(duration).toBe(PUBLIC_EXPIRY);
    expect(README).not.toMatch(/\b\d+-(?:day|hour)/);
  });
});
