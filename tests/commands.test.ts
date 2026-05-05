import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commands, window, env, workspace, createMockContext } from './vscode.mock';
import { registerCommands } from '../src/commands';

// Mock Ship SDK — keep named exports used by commands.ts and auth.ts
vi.mock('@shipstatic/ship', () => ({
  default: vi.fn().mockImplementation(() => ({
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
  })),
  PASSWORD_CONSTRAINTS: { MIN_LENGTH: 6, MAX_LENGTH: 128 },
  API_KEY: { PREFIX: 'ship-', HEX_LENGTH: 64, TOTAL_LENGTH: 69, HINT_LENGTH: 4 },
  validateApiKey: vi.fn(),
}));

// Get the mock Ship constructor for per-test control
import Ship from '@shipstatic/ship';
const MockShip = vi.mocked(Ship);

describe('commands', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    ctx = createMockContext();
    handlers = new Map();
    workspace.workspaceFolders = undefined;
    vi.clearAllMocks();

    // Capture command handlers
    commands.registerCommand.mockImplementation((id: string, cb: Function) => {
      handlers.set(id, cb);
      return { dispose: () => {} };
    });

    registerCommands(ctx);
  });

  it('registers all 3 commands', () => {
    expect(handlers.has('shipstatic.setApiKey')).toBe(true);
    expect(handlers.has('shipstatic.deploy')).toBe(true);
    expect(handlers.has('shipstatic.whoami')).toBe(true);
  });

  describe('setApiKey', () => {
    it('stores key and fires MCP change event', async () => {
      window.showInputBox.mockResolvedValueOnce('ship-newkey');

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.setApiKey')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith('shipstatic.apiKey', 'ship-newkey');
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire MCP change event when user cancels', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.setApiKey')!();

      expect(fireSpy).not.toHaveBeenCalled();
    });
  });

  describe('deploy', () => {
    it('shows error when no workspace folders', async () => {
      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Open a folder'));
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
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce('Copy URL');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
      });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      await handlers.get('shipstatic.deploy')!();

      // Verify SDK is constructed with the stored API key
      expect(MockShip).toHaveBeenCalledWith({ apiKey: 'ship-test' });
      // Verify upload is called with selected path and via tracking (no password)
      expect(mockUpload).toHaveBeenCalledWith('/test/dist', { via: 'vsc' });
      // Verify URL shown to user — uses canonical result.url, not reconstructed
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com',
        'Open in Browser',
        'Copy URL',
      );
      expect(env.clipboard.writeText).toHaveBeenCalledWith('https://happy-cat-abc1234.shipstatic.com');
    });

    it('forwards password to the SDK when user provides one', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('hunter2!');
      window.showInformationMessage.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
      });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      await handlers.get('shipstatic.deploy')!();

      expect(mockUpload).toHaveBeenCalledWith('/test/dist', { via: 'vsc', password: 'hunter2!' });
    });

    it('opens browser when user selects "Open in Browser"', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce('Open in Browser');

      await handlers.get('shipstatic.deploy')!();

      expect(env.openExternal).toHaveBeenCalled();
    });

    it('deploys without API key and shows expiry', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');
      window.showInformationMessage.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      await handlers.get('shipstatic.deploy')!();

      expect(MockShip).toHaveBeenCalledWith({});
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com — expires in 3 days',
        'Open in Browser',
        'Copy URL',
        'Set API Key',
      );
    });

    it('offers Set API Key from claimable deploy notification', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox
        .mockResolvedValueOnce('') // password prompt
        .mockResolvedValueOnce('ship-newkey'); // Set API Key prompt
      window.showInformationMessage.mockResolvedValueOnce('Set API Key');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith('shipstatic.apiKey', 'ship-newkey');
      expect(fireSpy).toHaveBeenCalled();
    });

    it('does not fire MCP event when Set API Key is cancelled', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox
        .mockResolvedValueOnce('') // password prompt
        .mockResolvedValueOnce(undefined); // Set API Key cancelled
      window.showInformationMessage.mockResolvedValueOnce('Set API Key');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
        url: 'https://happy-cat-abc1234.shipstatic.com',
        claim: 'https://my.shipstatic.com/claim/abc123',
      });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.deploy')!();

      expect(fireSpy).not.toHaveBeenCalled();
    });

    it('shows error on deployment failure', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInputBox.mockResolvedValueOnce('');

      MockShip.mockImplementationOnce(() => ({
        deployments: {
          upload: vi.fn().mockRejectedValue(new Error('Upload failed')),
        },
      }) as any);

      await handlers.get('shipstatic.deploy')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Upload failed');
    });
  });

  describe('whoami', () => {
    it('shows account info including custom domain usage (singular)', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      MockShip.mockImplementationOnce(() => ({
        whoami: vi.fn().mockResolvedValue({
          email: 'test@example.com',
          plan: 'standard',
          usage: { customDomains: 1 },
        }),
      }) as any);

      await handlers.get('shipstatic.whoami')!();

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (standard) · 1 custom domain',
      );
    });

    it('shows account info with plural domain count', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      MockShip.mockImplementationOnce(() => ({
        whoami: vi.fn().mockResolvedValue({
          email: 'test@example.com',
          plan: 'free',
          usage: { customDomains: 3 },
        }),
      }) as any);

      await handlers.get('shipstatic.whoami')!();

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 3 custom domains',
      );
    });

    it('shows zero domains as plural', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');

      await handlers.get('shipstatic.whoami')!();

      // Default mock returns customDomains: 0
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 0 custom domains',
      );
    });

    it('shows error on failure', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');

      MockShip.mockImplementationOnce(() => ({
        whoami: vi.fn().mockRejectedValue(new Error('Unauthorized')),
      }) as any);

      await handlers.get('shipstatic.whoami')!();

      expect(window.showErrorMessage).toHaveBeenCalledWith('ShipStatic: Unauthorized');
    });

    it('fires MCP change event when key is entered', async () => {
      window.showInputBox.mockResolvedValueOnce('ship-newkey');

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.whoami')!();

      expect(ctx.secrets.store).toHaveBeenCalledWith('shipstatic.apiKey', 'ship-newkey');
      expect(fireSpy).toHaveBeenCalled();
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'ShipStatic: test@example.com (free) · 0 custom domains',
      );
    });

    it('does not fire MCP event when key already stored', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');

      const { onDidChangeMcpServers } = await import('../src/mcp');
      const fireSpy = vi.spyOn(onDidChangeMcpServers, 'fire');

      await handlers.get('shipstatic.whoami')!();

      expect(fireSpy).not.toHaveBeenCalled();
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('does nothing when user cancels auth', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      await handlers.get('shipstatic.whoami')!();

      expect(MockShip).not.toHaveBeenCalled();
    });
  });
});
