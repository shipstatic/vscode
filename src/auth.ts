import { API_KEY, DEPLOY_TOKEN, validateToken } from '@shipstatic/types';
import * as vscode from 'vscode';

/**
 * One credential slot, one secret. `token` carries any platform token — a
 * `ship-` API key, a `deploy-` deploy token, or an opaque bearer — and the
 * SERVER classifies it by shape. This extension never inspects what it holds,
 * which is why a new credential population will never require a release here.
 */
const SECRET_KEY = 'shipstatic.token';

/**
 * The 0.2.x key, read only by `migrateSecret`. The clean-break law governs API
 * surface — command ids, env vars, option names — not a credential the user
 * already stored: a rename they never asked for must not log them out.
 */
const LEGACY_SECRET_KEY = 'shipstatic.apiKey';

/**
 * Move a 0.2.x credential onto the one-slot key, once, on activation.
 *
 * Ordered ahead of every registration in `extension.ts` deliberately — the MCP
 * provider is queried eagerly the moment the extension is active, so a
 * migration racing it would hand VS Code an anonymous server while a perfectly
 * good credential sat under the old key.
 */
export async function migrateSecret(context: vscode.ExtensionContext): Promise<void> {
  const legacy = await context.secrets.get(LEGACY_SECRET_KEY);
  if (legacy === undefined) return;

  // A credential already in the new slot wins: the old key can only have been
  // written by a version that predates it, so it is never the fresher of the two.
  if ((await context.secrets.get(SECRET_KEY)) === undefined) {
    await context.secrets.store(SECRET_KEY, legacy);
  }
  await context.secrets.delete(LEGACY_SECRET_KEY);
}

export async function getToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

export async function setToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const token = await vscode.window.showInputBox({
    title: 'ShipStatic token',
    prompt: 'Paste an API key or a deploy token — one slot takes either',
    placeHolder: `${API_KEY.PREFIX}… or ${DEPLOY_TOKEN.PREFIX}…`,
    password: true,
    ignoreFocusOut: true,
    // Delegated to the platform's own boundary validator so the rule lives in
    // one place: it applies the strict format rules to the two shapes it
    // recognises and asks only that anything else be non-empty, because an
    // opaque bearer's validity is the server's to decide.
    validateInput: (value) => {
      try {
        validateToken(value);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Invalid token';
      }
    },
  });

  if (token) {
    await context.secrets.store(SECRET_KEY, token);
    return token;
  }

  return undefined;
}
