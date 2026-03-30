import * as vscode from 'vscode';

const SECRET_KEY = 'shipstatic.apiKey';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

export async function setApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your ShipStatic API key',
    placeHolder: 'ship-...',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.startsWith('ship-')) return 'API key must start with "ship-"';
      return null;
    },
  });

  if (key) {
    await context.secrets.store(SECRET_KEY, key);
    return key;
  }

  return undefined;
}

export async function ensureApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = await getApiKey(context);
  if (existing) return existing;
  return setApiKey(context);
}
