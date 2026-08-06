import type * as vscode from 'vscode';
import { migrateSecret } from './auth';
import { registerCommands } from './commands';
import { registerMcpProvider } from './mcp';
import { createStatusBarItem } from './status-bar';

/**
 * Activation is async for one reason, and the ORDER is the reason: VS Code
 * queries the MCP provider as soon as the extension is active, so the 0.2.x
 * credential must have landed on the one-slot key before anything can read it.
 * Registering first and migrating after would start the agent's server
 * anonymously while the user's stored token sat one key over.
 */
export async function activate(context: vscode.ExtensionContext) {
  await migrateSecret(context);

  registerMcpProvider(context);
  registerCommands(context);
  createStatusBarItem(context);
}

export function deactivate() {}
