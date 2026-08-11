import { existsSync } from 'node:fs';
import Ship from '@shipstatic/ship';
import { API_KEY, ShipError } from '@shipstatic/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from '../src/commands';
import {
  type CommandHandler,
  commands,
  createMockContext,
  env,
  window,
  workspace,
} from './vscode.mock';

// The SDK is the one collaborator worth faking here: every command is a thin
// delegation to it. `@shipstatic/types` is deliberately NOT mocked — its
// constants, validators and `ShipError` are pure values, and asserting against
// a fake copy of them would assert against this file's own data.
vi.mock('@shipstatic/ship', () => ({
  // A function expression, not an arrow: `commands.ts` calls `new Ship(...)`,
  // and an arrow has no [[Construct]] — vitest 4 refuses to construct one and
  // hands back an empty object instead of the stub. The rule below offers an
  // autofix that would silently do exactly that, so it is off here by name.
  // biome-ignore lint/complexity/useArrowFunction: must be constructible — `new Ship(...)`
  default: vi.fn(function () {
    return {
      deployments: {
        upload: vi.fn().mockResolvedValue({
          deployment: 'happy-cat-abc1234.shipstatic.com',
          url: 'https://happy-cat-abc1234.shipstatic.com',
        }),
      },
      whoami: vi.fn().mockResolvedValue({
        email: 'test@example.com',
        plan: 'free',
        usage: { customDomains: 0 },
      }),
    };
  }),
}));

// The folder picker asks the filesystem what exists. Everything is present by
// default; individual cases turn paths off.
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

const MockShip = vi.mocked(Ship);
const mockExistsSync = vi.mocked(existsSync);

/** A constructible stub returning `instance` — see the note in `vi.mock` above. */
function shipReturning(instance: unknown) {
  // biome-ignore lint/complexity/useArrowFunction: must be constructible — `new Ship(...)`
  return function () {
    return instance;
  } as unknown as (options: unknown) => Ship;
}

/** Built from the shape constants — `setToken`'s validator is real, so a
 *  prompt needs input the platform would actually accept. */
const TEST_API_KEY = `${API_KEY.PREFIX}${'a'.repeat(API_KEY.HEX_LENGTH)}`;
const KEY = 'shipstatic.token';
const LAST_PATH = 'shipstatic.lastDeployPath';

const DEPLOYED = {
  deployment: 'happy-cat-abc1234.shipstatic.com',
  url: 'https://happy-cat-abc1234.shipstatic.com',
};
const CLAIMABLE = { ...DEPLOYED, claim: 'https://my.shipstatic.com/claims/claim-abc123' };

describe('commands', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let handlers: Map<string, CommandHandler>;

  /** Choose the offered folder whose label matches, the way a user would. */
  function chooseFolder(label: string) {
    window.showQuickPick.mockImplementationOnce(async (items: { label: string }[]) => {
      const match = items.find((i) => i.label === label);
      if (!match) {
        throw new Error(`no folder named "${label}" — offered: ${items.map((i) => i.label)}`);
      }
      return match;
    });
  }

  /** The labels the picker offered, in order. */
  const offered = () =>
    window.showQuickPick.mock.calls[0][0].map((i: { label: string }) => i.label);

  beforeEach(() => {
    ctx = createMockContext();
    handlers = new Map();
    workspace.workspaceFolders = [{ uri: { fsPath: '/test' }, name: 'test' }] as never;
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);

    commands.registerCommand.mockImplementation((id: string, cb: CommandHandler) => {
      handlers.set(id, cb);
      return { dispose: () => {} };
    });

    registerCommands(ctx);
  });

  it('registers every contributed command', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'shipstatic.deploy',
      'shipstatic.deployWithPassword',
      'shipstatic.setToken',
      'shipstatic.whoami',
    ]);
  });

  describe('setToken', () => {
    it('stores the token and fires the MCP change event', async () => {
      window.showInputBox.mockResolvedValueOnce(TEST_API_KEY);
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.setToken')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, TEST_API_KEY);
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire the MCP change event when the user cancels', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.setToken')!();

      expect(fireSpy).not.toHaveBeenCalled();
    });

    it('resolves to nothing, so the credential cannot ride out on the command result', async () => {
      // Any extension can `executeCommand('shipstatic.setToken')`; returning
      // the stored secret to that caller would hand it out.
      window.showInputBox.mockResolvedValueOnce(TEST_API_KEY);

      await expect(handlers.get('shipstatic.setToken')!()).resolves.toBeUndefined();
    });
  });

  describe('the folder picker', () => {
    it('shows an error and asks nothing when no folder is open', async () => {
      workspace.workspaceFolders = undefined;

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Open a folder'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it('offers build output, the workspace root, and a Browse escape', async () => {
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(offered()).toEqual(['dist', 'build', 'out', 'public', '_site', '/test', 'Browse…']);
    });

    it('puts the remembered folder first, so a repeat deploy is one keypress', async () => {
      ctx.workspaceState.get.mockReturnValueOnce('/test/dist');
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      const items = window.showQuickPick.mock.calls[0][0];
      expect(items[0]).toMatchObject({ label: '/test/dist', description: 'Last deployed' });
      // …and it is not offered a second time further down as build output.
      expect(items.filter((i: { path?: string }) => i.path === '/test/dist')).toHaveLength(1);
    });

    it('drops a remembered folder that no longer exists', async () => {
      // A build directory can be cleaned between sessions. A stale default
      // would fail the DEPLOY instead of the pick — the worse place to learn.
      ctx.workspaceState.get.mockReturnValueOnce('/test/gone');
      mockExistsSync.mockImplementation((p) => p !== '/test/gone');
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(offered()).not.toContain('/test/gone');
    });

    it('only offers folders that exist', async () => {
      mockExistsSync.mockImplementation((p) => p === '/test/dist' || p === '/test');
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(offered()).toEqual(['dist', '/test', 'Browse…']);
    });

    it('prefixes each root when the workspace has more than one', async () => {
      workspace.workspaceFolders = [
        { uri: { fsPath: '/a' }, name: 'site' },
        { uri: { fsPath: '/b' }, name: 'docs' },
      ] as never;
      mockExistsSync.mockImplementation((p) => p === '/a/dist' || p === '/b/dist');
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(offered()).toEqual(['site/dist', 'docs/dist', 'Browse…']);
    });

    it('falls back to the native dialog on Browse…', async () => {
      chooseFolder('Browse…');
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/elsewhere/site' }]);
      window.showInformationMessage.mockResolvedValueOnce(undefined);
      const upload = vi.fn().mockResolvedValue(DEPLOYED);
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload } }));

      await handlers.get('shipstatic.deploy')!();

      expect(upload).toHaveBeenCalledWith('/elsewhere/site', { via: 'vsc' });
    });

    it('returns early when the picker is dismissed', async () => {
      window.showQuickPick.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(MockShip).not.toHaveBeenCalled();
    });

    it('returns early when the native dialog is dismissed', async () => {
      chooseFolder('Browse…');
      window.showOpenDialog.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(MockShip).not.toHaveBeenCalled();
    });
  });

  describe('deploy', () => {
    it('deploys the picked folder and shows the URL', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce('Copy URL');
      const upload = vi.fn().mockResolvedValue(DEPLOYED);
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload } }));

      await handlers.get('shipstatic.deploy')!();

      // One slot: the stored credential rides the `token` option, whatever it is.
      expect(MockShip).toHaveBeenCalledWith({ token: TEST_API_KEY });
      expect(upload).toHaveBeenCalledWith('/test/dist', { via: 'vsc' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com',
        'Open in Browser',
        'Copy URL',
      );
      expect(env.clipboard.writeText).toHaveBeenCalledWith(DEPLOYED.url);
    });

    it('never prompts for a password', async () => {
      // The whole point of the sibling command: the common path pays nothing
      // for a feature most deploys do not use.
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce(undefined);
      const upload = vi.fn().mockResolvedValue(DEPLOYED);
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload } }));

      await handlers.get('shipstatic.deploy')!();

      expect(window.showInputBox).not.toHaveBeenCalled();
      expect(upload).toHaveBeenCalledWith('/test/dist', { via: 'vsc' });
    });

    it('remembers the folder after the deploy succeeded', async () => {
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce(undefined);
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockResolvedValue(DEPLOYED) } }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(ctx.workspaceState.update).toHaveBeenCalledWith(LAST_PATH, '/test/dist');
    });

    it('does not remember a folder whose deploy failed', async () => {
      // Remembering the mistake would make the next deploy default to it.
      chooseFolder('dist');
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockRejectedValue(new Error('nope')) } }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(ctx.workspaceState.update).not.toHaveBeenCalled();
    });

    it('opens the browser when the user selects "Open in Browser"', async () => {
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce('Open in Browser');

      await handlers.get('shipstatic.deploy')!();

      expect(env.openExternal).toHaveBeenCalled();
    });

    it('deploys anonymously with no token and shows the claim expiry', async () => {
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce(undefined);
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockResolvedValue(CLAIMABLE) } }),
      );

      await handlers.get('shipstatic.deploy')!();

      // Anonymity is the ABSENCE of a credential, in band: one construction,
      // an undefined token, no agent-token round trip. The 0.9.6 path minted
      // one through `POST /tokens/agent`, which the 2.x API deleted.
      expect(MockShip).toHaveBeenCalledWith({ token: undefined });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com — expires in 3 days',
        'Open in Browser',
        'Copy URL',
        'Set Token',
      );
    });

    it('offers Set Token from the claimable deploy notification', async () => {
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce('Set Token');
      window.showInputBox.mockResolvedValueOnce(TEST_API_KEY);
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockResolvedValue(CLAIMABLE) } }),
      );
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, TEST_API_KEY);
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire the MCP event when Set Token is cancelled', async () => {
      chooseFolder('dist');
      window.showInformationMessage.mockResolvedValueOnce('Set Token');
      window.showInputBox.mockResolvedValueOnce(undefined);
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockResolvedValue(CLAIMABLE) } }),
      );
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(fireSpy).not.toHaveBeenCalled();
    });

    it('shows an error on deployment failure', async () => {
      chooseFolder('dist');
      MockShip.mockImplementationOnce(
        shipReturning({
          deployments: { upload: vi.fn().mockRejectedValue(new Error('Upload failed')) },
        }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Upload failed');
    });

    it('falls back to its own sentence when what was thrown is not an Error', async () => {
      // JavaScript lets anything be thrown, and a rejection carrying a bare
      // string would otherwise reach the user as "ShipStatic: undefined".
      chooseFolder('dist');
      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockRejectedValue('nope') } }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Deployment failed');
    });
  });

  describe('deployWithPassword', () => {
    it('prompts once and forwards the password to the SDK', async () => {
      chooseFolder('dist');
      window.showInputBox.mockResolvedValueOnce('hunter22');
      window.showInformationMessage.mockResolvedValueOnce(undefined);
      const upload = vi.fn().mockResolvedValue(DEPLOYED);
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload } }));

      await handlers.get('shipstatic.deployWithPassword')!();

      expect(upload).toHaveBeenCalledWith('/test/dist', { via: 'vsc', password: 'hunter22' });
    });

    it('states the platform’s own length rule in the prompt', async () => {
      chooseFolder('dist');
      window.showInputBox.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deployWithPassword')!();

      expect(window.showInputBox.mock.calls[0][0].prompt).toContain('6–128');
    });

    it('deploys nothing when the password prompt is cancelled', async () => {
      chooseFolder('dist');
      window.showInputBox.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deployWithPassword')!();

      expect(MockShip).not.toHaveBeenCalled();
    });

    it('deploys nothing when the password is left empty', async () => {
      // This command exists to set one. An empty value is a cancelled intent,
      // not a request for an unprotected deploy — that is what `Deploy` is.
      chooseFolder('dist');
      window.showInputBox.mockResolvedValueOnce('');

      await handlers.get('shipstatic.deployWithPassword')!();

      expect(MockShip).not.toHaveBeenCalled();
    });
  });

  describe('an authentication failure offers the fix, not just the sentence', () => {
    it('offers Set Token when the platform rejects the credential', async () => {
      // Keyed on the TYPED error, never the message — the platform's own rule
      // for every other client. The claim flow already offered this on
      // anonymous SUCCESS; a present-but-rejected token was the one path that
      // knew exactly what was wrong and made the user go find the command.
      await ctx.secrets.store(KEY, TEST_API_KEY);
      chooseFolder('dist');
      window.showErrorMessage.mockResolvedValueOnce('Set Token');
      window.showInputBox.mockResolvedValueOnce(TEST_API_KEY);
      MockShip.mockImplementationOnce(
        shipReturning({
          deployments: {
            upload: vi.fn().mockRejectedValue(ShipError.authentication('Invalid API key')),
          },
        }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'ShipStatic: Invalid API key',
        'Set Token',
      );
      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, TEST_API_KEY);
    });

    it('offers nothing extra for a failure the editor cannot fix', async () => {
      chooseFolder('dist');
      MockShip.mockImplementationOnce(
        shipReturning({
          deployments: {
            upload: vi.fn().mockRejectedValue(ShipError.network('Connection refused')),
          },
        }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Connection refused');
    });

    it('reaches whoami too', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      window.showErrorMessage.mockResolvedValueOnce(undefined);
      MockShip.mockImplementationOnce(
        shipReturning({
          whoami: vi.fn().mockRejectedValue(ShipError.authentication('Token expired')),
        }),
      );

      await handlers.get('shipstatic.whoami')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'ShipStatic: Token expired',
        'Set Token',
      );
    });

    it('does not prompt when the user dismisses the offer', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      chooseFolder('dist');
      window.showErrorMessage.mockResolvedValueOnce(undefined);
      MockShip.mockImplementationOnce(
        shipReturning({
          deployments: {
            upload: vi.fn().mockRejectedValue(ShipError.authentication('Invalid API key')),
          },
        }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showInputBox).not.toHaveBeenCalled();
    });
  });

  describe('whoami', () => {
    it('shows account info including custom domain usage (singular)', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      MockShip.mockImplementationOnce(
        shipReturning({
          whoami: vi.fn().mockResolvedValue({
            email: 'test@example.com',
            plan: 'standard',
            usage: { customDomains: 1 },
          }),
        }),
      );

      await handlers.get('shipstatic.whoami')!();

      expect(MockShip).toHaveBeenCalledWith({ token: TEST_API_KEY });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (standard) · 1 custom domain',
      );
    });

    it('shows account info with plural domain count', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      MockShip.mockImplementationOnce(
        shipReturning({
          whoami: vi.fn().mockResolvedValue({
            email: 'test@example.com',
            plan: 'free',
            usage: { customDomains: 3 },
          }),
        }),
      );

      await handlers.get('shipstatic.whoami')!();

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 3 custom domains',
      );
    });

    it('shows zero domains as plural', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);

      await handlers.get('shipstatic.whoami')!();

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 0 custom domains',
      );
    });

    it('falls back to its own sentence when what was thrown is not an Error', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      MockShip.mockImplementationOnce(shipReturning({ whoami: vi.fn().mockRejectedValue('nope') }));

      await handlers.get('shipstatic.whoami')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'ShipStatic: Failed to get account info',
      );
    });

    it('fires the MCP change event when a token is entered', async () => {
      window.showInputBox.mockResolvedValueOnce(TEST_API_KEY);
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.whoami')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, TEST_API_KEY);
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire the MCP event when a token is already stored', async () => {
      await ctx.secrets.store(KEY, TEST_API_KEY);
      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.whoami')!();

      expect(fireSpy).not.toHaveBeenCalled();
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('does nothing when the user cancels the prompt', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.whoami')!();

      expect(MockShip).not.toHaveBeenCalled();
    });
  });
});
