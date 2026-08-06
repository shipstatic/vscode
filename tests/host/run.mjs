/**
 * The HOST tier — `pnpm test:host`. Downloads a real VS Code, launches it with
 * the built extension, and runs `suite.cjs` inside the extension host.
 *
 * This is the extension's analog of ship's child-process smoke tier, and it is
 * the only thing in the repo that can observe the CONTRACT WITH THE EDITOR.
 * Everything else runs against `tests/vscode.mock.ts` — a hand-written twin
 * whose members are now name-checked against `@types/vscode`, which is a
 * statement about the TYPES, not about the editor.
 *
 * That gap is not hypothetical. `engines.vscode` claimed `^1.99.0` from 0.2.x
 * until 2026-08-06 while `vscode.lm.registerMcpServerDefinitionProvider` does
 * not exist below 1.101 — so on the editors the Marketplace advertised,
 * `activate()` threw and the whole extension bricked, commands and status bar
 * included. Nothing in the suite could see it, because nothing in the suite
 * had ever met an editor.
 *
 * **The version is DERIVED from `engines`, never written here.** Testing any
 * other build would prove something about an editor the manifest makes no
 * promise about — and the promise is the thing under test.
 *
 * Deliberately minimal: it certifies that the extension loads, activates, and
 * registers what it contributes. Behaviour stays in the mock tier, which is
 * fast and does not download 100MB.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const ROOT = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));

/** The floor the manifest promises IS the editor under test. One fact, one place. */
const version = manifest.engines.vscode.replace(/^[\^~>=\s]*/, '');

try {
  await runTests({
    version,
    extensionDevelopmentPath: fileURLToPath(ROOT),
    extensionTestsPath: fileURLToPath(new URL('suite.cjs', import.meta.url)),
    // `--disable-extensions` isolates from anything installed on the machine;
    // the development extension still loads. The rest are what CI containers
    // need and a developer machine ignores.
    launchArgs: ['--disable-extensions', '--disable-gpu', '--no-sandbox'],
  });
  console.log(`\n✓ host tier green on VS Code ${version} (the engines floor)`);
} catch (error) {
  console.error(`\n✗ host tier failed on VS Code ${version}:`, error?.message ?? error);
  process.exit(1);
}
