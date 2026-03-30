import * as vscode from 'vscode';
import { registerMcpProvider } from './mcp';
import { registerCommands } from './commands';
import { createStatusBarItem } from './status-bar';

export function activate(context: vscode.ExtensionContext) {
  registerMcpProvider(context);
  registerCommands(context);
  createStatusBarItem(context);
}

export function deactivate() {}
