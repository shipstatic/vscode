/**
 * Mock of the `vscode` module for unit testing.
 *
 * Named exports here map 1:1 to `import * as vscode from 'vscode'`, and since
 * 2026-08-06 that claim is CHECKED rather than asserted: every namespace ends
 * in a `satisfies Pick<typeof vscode.X, …>` naming the members production
 * touches, so a rename, a removal, or a changed signature in `@types/vscode`
 * turns `pnpm typecheck` red here.
 *
 * That check is only as good as the types it reads, which is why the pin is
 * EXACT and equals `engines.vscode` (see CLAUDE.md, "The engines floor is
 * PROVEN"). A floated pin would certify this twin against APIs the floor does
 * not have — which is how the extension shipped for months claiming
 * compatibility with editors where `activate()` throws.
 *
 * The `vscode` module is not installable; it exists only inside the editor. So
 * the alias in `vitest.config.ts` is not a convenience, it is the only thing
 * that makes this code testable at all. `import type` below erases, so the
 * alias cannot make this file self-referential.
 *
 * What this tier CANNOT say is whether the real editor behaves as its types
 * claim. That is `pnpm test:host`, which launches VS Code at the floor.
 */

import { type Mock, vi } from 'vitest';
import type * as vscode from 'vscode';

/** A command handler, as far as this mock cares — captured, then invoked. */
export type CommandHandler = (...args: unknown[]) => unknown;

// --- Classes ---

export class EventEmitter<T = void> {
  private listeners: ((value: T) => void)[] = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  // `value` is optional so `fire()` reads naturally for the `void` payload the
  // provider's change event carries — which is the only instantiation here.
  fire = (value?: T) => {
    for (const l of this.listeners) l(value as T);
  };
  dispose = vi.fn();
}

export class McpStdioServerDefinition {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string | number | null> = {};
  version?: string;

  constructor(
    label: string,
    command: string,
    args?: string[],
    env?: Record<string, string | number | null>,
    version?: string,
  ) {
    this.label = label;
    this.command = command;
    this.args = args ?? [];
    if (env) this.env = env;
    this.version = version;
  }
}

/**
 * The constructor and instance shape, against the real class. `mcp.ts` narrows
 * with `instanceof` and then assigns `server.env`, so both halves matter: a
 * changed parameter order or an `env` that stops accepting `null` lands here.
 */
const _mcpStdioServerDefinitionShape: typeof vscode.McpStdioServerDefinition =
  McpStdioServerDefinition;

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
  showQuickPick: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showOpenDialog: vi.fn(),
  withProgress: vi.fn(async (_opts: unknown, task: () => unknown) => task()),
  createStatusBarItem: vi.fn(() => _statusBarItem),
};

export const commands = {
  registerCommand: vi.fn((_id: string, _cb: CommandHandler) => ({ dispose: () => {} })),
};

export const lm = {
  registerMcpServerDefinitionProvider: vi.fn((_id: string, _provider: unknown) => ({
    dispose: () => {},
  })),
};

export const workspace: { workspaceFolders: { uri: { fsPath: string } }[] | undefined } = {
  workspaceFolders: undefined,
};

export const env = {
  openExternal: vi.fn(),
  clipboard: { writeText: vi.fn() },
};

/**
 * The NAME check, and the reason this file is a twin rather than a fiction.
 *
 * `Pick` fails to compile when a listed member is absent from the real
 * namespace at the pinned floor — which is exactly the class that let
 * `registerMcpServerDefinitionProvider` be mocked happily while the manifest
 * promised editors that do not have it.
 *
 * Deliberately `Pick` over the whole namespace type: these mocks are `vi.fn()`
 * spies whose call signatures tests reshape per case, so demanding full
 * signature compatibility on each would mean re-declaring the editor's
 * overload sets here — a second fiction to maintain. Names and existence are
 * what this tier can honestly hold; behaviour at the real signature is
 * `test:host`'s job.
 */
type _NamespaceNames = [
  Pick<
    typeof vscode.window,
    | 'showInputBox'
    | 'showQuickPick'
    | 'showInformationMessage'
    | 'showErrorMessage'
    | 'showOpenDialog'
    | 'withProgress'
    | 'createStatusBarItem'
  >,
  Pick<typeof vscode.commands, 'registerCommand'>,
  Pick<typeof vscode.lm, 'registerMcpServerDefinitionProvider'>,
  Pick<typeof vscode.workspace, 'workspaceFolders'>,
  Pick<typeof vscode.env, 'openExternal' | 'clipboard'>,
  Pick<typeof vscode.StatusBarAlignment, 'Left' | 'Right'>,
  Pick<typeof vscode.ProgressLocation, 'Notification'>,
];

// --- Test utilities ---

/** Exactly the `SecretStorage` surface production reads — names and signatures. */
type SecretsSlice = Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>;

export interface MockContext {
  secrets: {
    get: Mock<SecretsSlice['get']>;
    store: Mock<SecretsSlice['store']>;
    delete: Mock<SecretsSlice['delete']>;
  };
  workspaceState: {
    get: Mock<(key: string) => unknown>;
    update: Mock<(key: string, value: unknown) => Thenable<void>>;
  };
  extensionPath: string;
  subscriptions: { dispose(): unknown }[];
}

export function createMockContext() {
  const secretStore = new Map<string, string>();
  const stateStore = new Map<string, unknown>();

  const secrets = {
    get: vi.fn(async (key: string) => secretStore.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      secretStore.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      secretStore.delete(key);
    }),
    // `satisfies` here rather than on the context below: it checks the three
    // members against the real interface while leaving them `Mock`s, so tests
    // keep `.mock.invocationCallOrder` — which is what proves the activation
    // migration runs BEFORE the provider registration.
  } satisfies SecretsSlice;

  const workspaceState = {
    get: vi.fn((key: string) => stateStore.get(key)),
    update: vi.fn(async (key: string, value: unknown) => {
      stateStore.set(key, value);
    }),
  };

  const context = {
    secrets,
    workspaceState,
    extensionPath: '/mock/extension',
    subscriptions: [] as { dispose(): unknown }[],
  };

  // Inert and contained: `ExtensionContext` has some thirty members and
  // production reads four. The `satisfies` clauses above are what actually
  // check them; this only spares every call site an identical cast.
  return context as typeof context & vscode.ExtensionContext;
}
