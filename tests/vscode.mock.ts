/**
 * Mock of the `vscode` module for unit testing.
 *
 * Named exports here map 1:1 to `import * as vscode from 'vscode'`.
 * Test utilities (createMockContext, etc.) are also exported for convenience.
 */
import { vi } from 'vitest';

// --- Classes ---

export class EventEmitter<T = void> {
  private listeners: Function[] = [];
  event = (listener: Function) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire = (...args: any[]) => this.listeners.forEach((l) => l(...args));
  dispose = vi.fn();
}

export class McpStdioServerDefinition {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string | number | null> = {};
  version?: string;

  constructor(label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) {
    this.label = label;
    this.command = command;
    this.args = args ?? [];
    if (env) this.env = env;
    this.version = version;
  }
}

// --- Constants ---

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ProgressLocation = { Notification: 15 } as const;
export const Uri = { parse: vi.fn((s: string) => ({ toString: () => s })) };

// --- Status bar singleton (accessible in tests) ---

export const _statusBarItem = {
  text: '',
  tooltip: '',
  command: '',
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

// --- Namespaces ---

export const window = {
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showOpenDialog: vi.fn(),
  withProgress: vi.fn(async (_opts: any, task: Function) => task()),
  createStatusBarItem: vi.fn(() => _statusBarItem),
};

export const commands = {
  registerCommand: vi.fn((_id: string, _cb: Function) => ({ dispose: () => {} })),
};

export const lm = {
  registerMcpServerDefinitionProvider: vi.fn((_id: string, _provider: any) => ({ dispose: () => {} })),
};

export const workspace: { workspaceFolders: any[] | undefined } = {
  workspaceFolders: undefined,
};

export const env = {
  openExternal: vi.fn(),
  clipboard: { writeText: vi.fn() },
};

// --- Test utilities ---

export function createMockContext() {
  const store = new Map<string, string>();
  return {
    secrets: {
      get: vi.fn(async (key: string) => store.get(key)),
      store: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
    },
    extensionPath: '/mock/extension',
    subscriptions: [] as { dispose: () => void }[],
  } as any;
}
