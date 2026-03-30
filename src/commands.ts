import * as vscode from 'vscode';
import Ship from '@shipstatic/ship';
import { setApiKey, ensureApiKey } from './auth';
import { onDidChangeMcpServers } from './mcp';

export function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('shipstatic.setApiKey', async () => {
      const key = await setApiKey(context);
      if (key) onDidChangeMcpServers.fire();
    }),
    vscode.commands.registerCommand('shipstatic.deploy', () => deploy(context)),
    vscode.commands.registerCommand('shipstatic.whoami', () => whoami(context)),
  );
}

async function deploy(context: vscode.ExtensionContext) {
  const apiKey = await ensureApiKey(context);
  if (!apiKey) return;

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

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Deploying to ShipStatic...' },
      async () => {
        const ship = new Ship({ apiKey });
        const result = await ship.deployments.upload(uri[0].fsPath, { via: 'vscode' });
        const url = `https://${result.deployment}`;

        const action = await vscode.window.showInformationMessage(
          `Deployed to ${url}`,
          'Open in Browser',
          'Copy URL',
        );

        if (action === 'Open in Browser') vscode.env.openExternal(vscode.Uri.parse(url));
        if (action === 'Copy URL') vscode.env.clipboard.writeText(url);
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deployment failed';
    vscode.window.showErrorMessage(`ShipStatic: ${message}`);
  }
}

async function whoami(context: vscode.ExtensionContext) {
  const apiKey = await ensureApiKey(context);
  if (!apiKey) return;

  try {
    const ship = new Ship({ apiKey });
    const account = await ship.whoami();
    vscode.window.showInformationMessage(
      `ShipStatic: ${account.email} (${account.plan})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get account info';
    vscode.window.showErrorMessage(`ShipStatic: ${message}`);
  }
}
