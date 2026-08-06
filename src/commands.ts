import Ship from '@shipstatic/ship';
import { PASSWORD_CONSTRAINTS, PUBLIC_DEPLOYMENT_TTL_SECONDS } from '@shipstatic/types';
import * as vscode from 'vscode';
import { getToken, setToken } from './auth';
import { onDidChangeMcpServers } from './mcp';

/**
 * The anonymous-deploy lifetime, DERIVED from the platform constant rather
 * than written out. `@shipstatic/types` owns the number and every surface
 * quoting it derives from there, so a TTL change cannot leave a sentence
 * behind.
 *
 * Exported for `tests/docs-contract.test.ts`, which holds the published
 * listing to this exact phrase — the fence has to read production's own
 * value, or it is two hand-written statements agreeing with each other.
 */
export const PUBLIC_EXPIRY = `${PUBLIC_DEPLOYMENT_TTL_SECONDS / 86_400} days`;

/** The action label offered on an anonymous deploy — one string, two uses. */
const SET_TOKEN = 'Set Token';

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    // Returns void on purpose: a command's result is readable by anything that
    // can call `executeCommand`, and the credential must not ride out that way.
    vscode.commands.registerCommand('shipstatic.setToken', async () => {
      await promptForToken(context);
    }),
    vscode.commands.registerCommand('shipstatic.deploy', () => deploy(context)),
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

async function deploy(context: vscode.ExtensionContext) {
  const token = await getToken(context);

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage('Open a folder to deploy.');
    return;
  }

  const uri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: folders[0].uri,
    openLabel: 'Deploy',
    title: 'Select directory to deploy',
  });

  if (!uri?.[0]) return;

  const password = await vscode.window.showInputBox({
    title: 'Password protection (optional)',
    prompt: `Leave empty to deploy without a password. ${PASSWORD_CONSTRAINTS.MIN_LENGTH}–${PASSWORD_CONSTRAINTS.MAX_LENGTH} characters if set.`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'No password',
  });
  if (password === undefined) return;

  try {
    // One slot, one construction. An absent token is not a second case: the
    // request simply carries no credential, and the API grants the public
    // account per request, answering with a claim URL.
    const ship = new Ship({ token });
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Deploying to ShipStatic...' },
      () =>
        ship.deployments.upload(uri[0].fsPath, {
          via: 'vsc',
          ...(password ? { password } : {}),
        }),
    );

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
    const message = error instanceof Error ? error.message : 'Deployment failed';
    vscode.window.showErrorMessage(`ShipStatic: ${message}`);
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
    const message = error instanceof Error ? error.message : 'Failed to get account info';
    vscode.window.showErrorMessage(`ShipStatic: ${message}`);
  }
}
