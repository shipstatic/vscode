import * as vscode from 'vscode';
import { API_KEY, validateApiKey } from '@shipstatic/ship';

const SECRET_KEY = 'shipstatic.apiKey';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

export async function setApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your ShipStatic API key',
    placeHolder: `${API_KEY.PREFIX}...`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        validateApiKey(value);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Invalid API key';
      }
    },
  });

  if (key) {
    await context.secrets.store(SECRET_KEY, key);
    return key;
  }

  return undefined;
}
