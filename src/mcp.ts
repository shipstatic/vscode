import * as vscode from 'vscode';
import * as path from 'path';
import { getApiKey } from './auth';

const emitter = new vscode.EventEmitter<void>();

/** Fire after API key changes so VS Code re-queries the provider. */
export const onDidChangeMcpServers = emitter;

export function registerMcpProvider(context: vscode.ExtensionContext) {
  const disposable = vscode.lm.registerMcpServerDefinitionProvider('shipstatic', {
    onDidChangeMcpServerDefinitions: emitter.event,

    // Called eagerly — MUST NOT require user interaction.
    provideMcpServerDefinitions: async () => {
      return [
        new vscode.McpStdioServerDefinition(
          'ShipStatic',
          process.execPath,
          [path.join(context.extensionPath, 'dist', 'mcp-server.js')],
        ),
      ];
    },

    // Called when the server is about to start — no prompt.
    // Server starts without API key (claimable deploys). User sets key via command.
    resolveMcpServerDefinition: async (server) => {
      const apiKey = await getApiKey(context);
      if (apiKey) server.env = { SHIP_API_KEY: apiKey };
      return server;
    },
  });

  context.subscriptions.push(disposable, emitter);
}
