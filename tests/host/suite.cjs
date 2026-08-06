/**
 * What runs INSIDE the editor. `@vscode/test-electron` requires this file in
 * the extension host and awaits `run()`; anything thrown fails the tier.
 *
 * CommonJS on purpose — the extension host `require`s it, and `vscode` itself
 * is only resolvable from there.
 *
 * Three assertions, and the first two carry almost all the weight:
 *
 *   1. The editor found the extension at all — a manifest the Marketplace
 *      would reject never gets here.
 *   2. `activate()` resolved. That IS the API-floor proof: activation
 *      registers the MCP server definition provider FIRST, so on an editor
 *      without `vscode.lm.registerMcpServerDefinitionProvider` this throws and
 *      nothing else in the extension exists either. It is also the only check
 *      anywhere that loads the BUILT `dist/extension.js` — every other test
 *      runs `src/`.
 *   3. Everything the manifest contributes is really registered, read FROM the
 *      manifest so a new command cannot arrive unproven.
 */
const assert = require('node:assert/strict');
const vscode = require('vscode');

const manifest = require('../../package.json');
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;

exports.run = async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `the editor did not find ${EXTENSION_ID}`);

  await extension.activate();
  assert.equal(extension.isActive, true, 'activate() resolved but the extension is not active');

  const registered = await vscode.commands.getCommands(true);
  for (const { command } of manifest.contributes.commands) {
    assert.ok(registered.includes(command), `contributed but not registered: ${command}`);
  }

  console.log(
    `  ✓ ${EXTENSION_ID} activated on ${vscode.version}; ` +
      `${manifest.contributes.commands.length} commands registered`,
  );
};
