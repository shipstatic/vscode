import * as path from 'node:path';
import { SHIP_ENV } from '@shipstatic/types';
import * as vscode from 'vscode';
import { getToken } from './auth';

const emitter = new vscode.EventEmitter<void>();

/** Fire after the stored credential changes so VS Code re-queries the provider. */
export const onDidChangeMcpServers = emitter;

export function registerMcpProvider(context: vscode.ExtensionContext) {
  const disposable = vscode.lm.registerMcpServerDefinitionProvider('shipstatic', {
    onDidChangeMcpServerDefinitions: emitter.event,

    // Called eagerly — MUST NOT require user interaction.
    provideMcpServerDefinitions: async () => {
      return [
        new vscode.McpStdioServerDefinition('ShipStatic', process.execPath, [
          path.join(context.extensionPath, 'dist', 'mcp-server.js'),
        ]),
      ];
    },

    // Called when the server is about to start — no prompt.
    // The server always starts: without a token it deploys to the public
    // account and answers with a claim URL. The user sets one via command.
    //
    // Credentials come exclusively from VS Code SecretStorage. The env block
    // below is the WHOLE environment the child sees for SHIP_*: both of the
    // SDK's documented variables are stated, so a value the developer exports
    // for CLI use can never reach the agent — neither a credential that would
    // silently authenticate an "anonymous" deploy, nor an endpoint that would
    // redirect one (per @shipstatic/ship, "strict-isolation contract for
    // embedded hosts": scrubbing is the host's job, not the SDK's).
    //
    // The list shrank from three to two at 1.0.0 because the SDK's env
    // contract did: SHIP_API_KEY and SHIP_DEPLOY_TOKEN are read by nothing in
    // the one-credential world, and nulling a variable no one reads is noise
    // that reads like protection.
    //
    // Since types 2.5.0-beta.21 the block DERIVES from `SHIP_ENV` — the SDK's
    // own statement of its ambient pair — so a grown env contract reaches this
    // scrub at the pin bump that introduces it. The test stays HAND-PINNED on
    // the two names deliberately: growth turns it red, and a human widens the
    // scrub knowingly rather than a derivation widening it silently.
    resolveMcpServerDefinition: async (server) => {
      // This provider only ever provides stdio definitions; the narrowing
      // tells the type system what the provider already guarantees.
      if (server instanceof vscode.McpStdioServerDefinition) {
        const token = await getToken(context);
        const env: Record<string, string | null> = Object.fromEntries(
          Object.values(SHIP_ENV).map((name) => [name, null]),
        );
        env[SHIP_ENV.TOKEN] = token ?? null;
        server.env = env;
      }
      return server;
    },
  });

  context.subscriptions.push(disposable, emitter);
}
