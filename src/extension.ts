import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerMcpProvider } from './mcp';
import { createStatusBarItem } from './status-bar';

export function activate(context: vscode.ExtensionContext) {
  registerMcpProvider(context);
  registerCommands(context);
  createStatusBarItem(context);
}

export function deactivate() {}
