import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_EXPIRY } from '@shipstatic/mcp';
import Ship from '@shipstatic/ship';
import { ErrorType, isShipError, PASSWORD_CONSTRAINTS } from '@shipstatic/types';
import * as vscode from 'vscode';
import { getToken, setToken } from './auth';
import { onDidChangeMcpServers } from './mcp';

/**
 * The anonymous-deploy lifetime is QUOTED, never authored here.
 *
 * `@shipstatic/types` owns the number (`PUBLIC_DEPLOYMENT_TTL_SECONDS`) and
 * `@shipstatic/mcp`'s vocabulary authors the one English phrase derived from
 * it — the phrase both transports, the bundled server's instructions, and this
 * palette notification all speak. One owner is the entire point: this file
 * carried its own derivation of the same expression once, which is two
 * statements of one sentence in two repos, and exactly the drift class the
 * vocabulary module exists to delete.
 *
 * Re-exported for `tests/docs-contract.test.ts`, which holds the published
 * listing to the phrase THIS surface actually shows — the fence reads
 * production's own value, not a copy of it.
 */
export { PUBLIC_EXPIRY } from '@shipstatic/mcp';

/** The action label offered on an anonymous deploy and on an auth failure. */
const SET_TOKEN = 'Set Token';

/** Where the last deployed folder is remembered — per workspace, by design. */
const LAST_DEPLOY_PATH = 'shipstatic.lastDeployPath';

/**
 * Conventional build-output directory names, offered when they exist.
 *
 * A heuristic, and safe to be one: a name missing from this list costs a
 * SUGGESTION, never a deploy — "Browse…" is always the last item. Which is
 * also why it does not try to detect frameworks.
 */
const BUILD_OUTPUT_DIRS = ['dist', 'build', 'out', 'public', '_site'];

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    // Returns void on purpose: a command's result is readable by anything that
    // can call `executeCommand`, and the credential must not ride out that way.
    vscode.commands.registerCommand('shipstatic.setToken', async () => {
      await promptForToken(context);
    }),
    vscode.commands.registerCommand('shipstatic.deploy', () => deploy(context, false)),
    vscode.commands.registerCommand('shipstatic.deployWithPassword', () => deploy(context, true)),
    vscode.commands.registerCommand('shipstatic.whoami', () => whoami(context)),
  );
}

/**
 * Prompt for a credential and, when one is stored, tell VS Code to re-query
 * the MCP provider so the server restarts holding it.
 *
 * Every path that stores a credential goes through here. It was three call
 * sites each remembering to fire the event by hand, and forgetting is silent —
 * the agent simply keeps deploying anonymously after the user sets a token.
 */
async function promptForToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const token = await setToken(context);
  if (token) onDidChangeMcpServers.fire();
  return token;
}

/** A folder offered in the picker. `path` is absent on the "Browse…" escape. */
interface FolderItem extends vscode.QuickPickItem {
  path?: string;
}

/**
 * Choose what to deploy — remembered folder first, then what exists, then the
 * native dialog.
 *
 * The picker replaced an unconditional OS folder dialog. The choice is
 * load-bearing and stays: build output lives in a subdirectory, and the SDK
 * rightly refuses an unbuilt source root. What went is the REPETITION — the
 * persona (root `PERSONA.md`, "the Accidental Builder") deploys the same
 * folder over and over, and was paying a modal file browser for it every time.
 * Second deploy onward is Enter.
 */
async function pickFolder(context: vscode.ExtensionContext): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage('Open a folder to deploy.');
    return undefined;
  }

  const items: FolderItem[] = [];
  const seen = new Set<string>();
  const multiRoot = folders.length > 1;

  const offer = (path: string, label: string, description?: string) => {
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    items.push({ label, description, path });
  };

  // Remembered first and therefore preselected — but validated, because a
  // folder can be renamed or cleaned between sessions and a stale default
  // would fail the deploy instead of the pick.
  const remembered = context.workspaceState.get<string>(LAST_DEPLOY_PATH);
  if (remembered) offer(remembered, remembered, 'Last deployed');

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    const prefix = multiRoot ? `${folder.name}/` : '';
    for (const name of BUILD_OUTPUT_DIRS) {
      offer(join(root, name), `${prefix}${name}`, 'Build output');
    }
    offer(root, multiRoot ? folder.name : root, 'Workspace root');
  }

  items.push({ label: 'Browse…', description: 'Pick another folder' });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Deploy to ShipStatic',
    placeHolder: 'Select the folder to deploy',
  });
  if (!picked) return undefined;
  if (picked.path) return picked.path;

  const uri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: folders[0].uri,
    openLabel: 'Deploy',
    title: 'Select directory to deploy',
  });
  return uri?.[0]?.fsPath;
}

async function deploy(context: vscode.ExtensionContext, withPassword: boolean) {
  const token = await getToken(context);

  const path = await pickFolder(context);
  if (!path) return;

  // The main Deploy never asks. Password protection is a sibling command, so
  // the common path is one pick and the feature stays one palette entry away
  // for the deploys that want it — rather than a prompt every deploy pays.
  let password: string | undefined;
  if (withPassword) {
    password = await vscode.window.showInputBox({
      title: 'Password protection',
      prompt: `Visitors must enter this to view the site. ${PASSWORD_CONSTRAINTS.MIN_LENGTH}–${PASSWORD_CONSTRAINTS.MAX_LENGTH} characters.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) return;
  }

  try {
    // One slot, one construction. An absent token is not a second case: the
    // request simply carries no credential, and the API grants the public
    // account per request, answering with a claim URL.
    const ship = new Ship({ token });
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Deploying to ShipStatic...' },
      () =>
        ship.deployments.upload(path, {
          via: 'vsc',
          ...(password ? { password } : {}),
        }),
    );

    // Only after it worked: remembering a path that failed would make the next
    // deploy default to the mistake.
    await context.workspaceState.update(LAST_DEPLOY_PATH, path);

    const url = result.url;
    const actions: string[] = ['Open in Browser', 'Copy URL'];
    if (result.claim) actions.push(SET_TOKEN);

    const action = await vscode.window.showInformationMessage(
      result.claim ? `Deployed to ${url} — expires in ${PUBLIC_EXPIRY}` : `Deployed to ${url}`,
      ...actions,
    );

    if (action === 'Open in Browser') vscode.env.openExternal(vscode.Uri.parse(url));
    if (action === 'Copy URL') vscode.env.clipboard.writeText(url);
    if (action === SET_TOKEN) await promptForToken(context);
  } catch (error) {
    await report(context, error, 'Deployment failed');
  }
}

async function whoami(context: vscode.ExtensionContext) {
  let token = await getToken(context);
  if (!token) {
    token = await promptForToken(context);
    if (!token) return;
  }

  try {
    const ship = new Ship({ token });
    const account = await ship.whoami();
    const customDomains = account.usage.customDomains;
    vscode.window.showInformationMessage(
      `ShipStatic: ${account.email} (${account.plan}) · ${customDomains} custom domain${customDomains === 1 ? '' : 's'}`,
    );
  } catch (error) {
    await report(context, error, 'Failed to get account info');
  }
}

/**
 * Report a failure — and, where the platform named a cause the editor can act
 * on, offer the action instead of only the sentence.
 *
 * A rejected credential is the one failure a GUI can fix in place. The CLI
 * answers the same error with prose ("pass --token, set SHIP_TOKEN, or run
 * ship config") because a terminal has nothing else to offer; a notification
 * has a button. The claim flow already offered `Set Token` on anonymous
 * SUCCESS, so a present-but-rejected token was the only path that knew exactly
 * what was wrong and made the user go find the command themselves.
 *
 * Keyed on the typed error, never on the message — the platform's own rule for
 * every other client.
 */
async function report(context: vscode.ExtensionContext, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;

  if (isShipError(error) && error.isType(ErrorType.Authentication)) {
    const action = await vscode.window.showErrorMessage(`ShipStatic: ${message}`, SET_TOKEN);
    if (action === SET_TOKEN) await promptForToken(context);
    return;
  }

  vscode.window.showErrorMessage(`ShipStatic: ${message}`);
}
