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
// constants and validators are pure values, and asserting against a fake copy
// of them would assert against this file's own data.
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

// Get the mock Ship constructor for per-test control
import Ship from '@shipstatic/ship';

const MockShip = vi.mocked(Ship);

/** A constructible stub returning `instance` — see the note in `vi.mock` above. */
function shipReturning(instance: unknown) {
  // biome-ignore lint/complexity/useArrowFunction: must be constructible — `new Ship(...)`
  return function () {
    return instance;
  } as unknown as (options: unknown) => Ship;
}

/** 69 chars — the validator in `setToken` is real, so prompts need real input. */
const API_KEY = `ship-${'a'.repeat(64)}`;
const KEY = 'shipstatic.token';

describe('commands', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let handlers: Map<string, CommandHandler>;

  beforeEach(() => {
    ctx = createMockContext();
    handlers = new Map();
    workspace.workspaceFolders = undefined;
    vi.clearAllMocks();

    // Capture command handlers
    commands.registerCommand.mockImplementation((id: string, cb: CommandHandler) => {
      handlers.set(id, cb);
      return { dispose: () => {} };
    });

    registerCommands(ctx);
  });

  it('registers all 3 commands', () => {
    expect(handlers.has('shipstatic.setToken')).toBe(true);
    expect(handlers.has('shipstatic.deploy')).toBe(true);
    expect(handlers.has('shipstatic.whoami')).toBe(true);
  });

  describe('setToken', () => {
    it('stores the token and fires the MCP change event', async () => {
      window.showInputBox.mockResolvedValueOnce(API_KEY);

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.setToken')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, API_KEY);
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
      window.showInputBox.mockResolvedValueOnce(API_KEY);

      await expect(handlers.get('shipstatic.setToken')!()).resolves.toBeUndefined();
    });
  });

  describe('deploy', () => {
    it('shows error when no workspace folders', async () => {
      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Open a folder'),
      );
    });

    it('returns early when user cancels folder picker', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(MockShip).not.toHaveBeenCalled();
    });

    it('returns early when user cancels password prompt', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.deploy')!();

      expect(MockShip).not.toHaveBeenCalled();
    });

    it('deploys with correct SDK args and shows URL', async () => {
      await ctx.secrets.store(KEY, API_KEY);
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce('Copy URL');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
      });
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload: mockUpload } }));

      await handlers.get('shipstatic.deploy')!();

      // One slot: the stored credential rides the `token` option, whatever it is.
      expect(MockShip).toHaveBeenCalledWith({ token: API_KEY });
      // Verify upload is called with selected path and via tracking (no password)
      expect(mockUpload).toHaveBeenCalledWith('/test/dist', { via: 'vsc' });
      // Verify URL shown to user — uses canonical result.url, not reconstructed
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com',
        'Open in Browser',
        'Copy URL',
      );
      expect(env.clipboard.writeText).toHaveBeenCalledWith(
        'https://happy-cat-abc1234.shipstatic.com',
      );
    });

    it('forwards password to the SDK when user provides one', async () => {
      await ctx.secrets.store(KEY, API_KEY);
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('hunter2!');
      window.showInformationMessage.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
      });
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload: mockUpload } }));

      await handlers.get('shipstatic.deploy')!();

      expect(mockUpload).toHaveBeenCalledWith('/test/dist', { via: 'vsc', password: 'hunter2!' });
    });

    it('opens browser when user selects "Open in Browser"', async () => {
      await ctx.secrets.store(KEY, API_KEY);
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce('Open in Browser');

      await handlers.get('shipstatic.deploy')!();

      expect(env.openExternal).toHaveBeenCalled();
    });

    it('deploys anonymously with no token and shows the claim expiry', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload: mockUpload } }));

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
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox
        .mockResolvedValueOnce('') // password prompt
        .mockResolvedValueOnce(API_KEY); // Set Token prompt
      window.showInformationMessage.mockResolvedValueOnce('Set Token');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload: mockUpload } }));

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, API_KEY);
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire MCP event when Set Token is cancelled', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox
        .mockResolvedValueOnce('') // password prompt
        .mockResolvedValueOnce(undefined); // Set Token cancelled
      window.showInformationMessage.mockResolvedValueOnce('Set Token');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(shipReturning({ deployments: { upload: mockUpload } }));

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(fireSpy).not.toHaveBeenCalled();
    });

    it('shows error on deployment failure', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');

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
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');

      MockShip.mockImplementationOnce(
        shipReturning({ deployments: { upload: vi.fn().mockRejectedValue('nope') } }),
      );

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Deployment failed');
    });
  });

  describe('whoami', () => {
    it('shows account info including custom domain usage (singular)', async () => {
      await ctx.secrets.store(KEY, API_KEY);
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

      expect(MockShip).toHaveBeenCalledWith({ token: API_KEY });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (standard) · 1 custom domain',
      );
    });

    it('shows account info with plural domain count', async () => {
      await ctx.secrets.store(KEY, API_KEY);
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
      await ctx.secrets.store(KEY, API_KEY);

      await handlers.get('shipstatic.whoami')!();

      // Default mock returns customDomains: 0
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 0 custom domains',
      );
    });

    it('shows error on failure', async () => {
      await ctx.secrets.store(KEY, API_KEY);

      MockShip.mockImplementationOnce(
        shipReturning({ whoami: vi.fn().mockRejectedValue(new Error('Unauthorized')) }),
      );

      await handlers.get('shipstatic.whoami')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Unauthorized');
    });

    it('falls back to its own sentence when what was thrown is not an Error', async () => {
      await ctx.secrets.store(KEY, API_KEY);

      MockShip.mockImplementationOnce(shipReturning({ whoami: vi.fn().mockRejectedValue('nope') }));

      await handlers.get('shipstatic.whoami')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        'ShipStatic: Failed to get account info',
      );
    });

    it('fires MCP change event when a token is entered', async () => {
      window.showInputBox.mockResolvedValueOnce(API_KEY);

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.whoami')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, API_KEY);
      expect(fireSpy).toHaveBeenCalled();
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 0 custom domains',
      );
    });

    it('does not fire MCP event when a token is already stored', async () => {
      await ctx.secrets.store(KEY, API_KEY);

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
