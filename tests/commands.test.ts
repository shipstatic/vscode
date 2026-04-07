import { describe, it, expect, vi, beforeEach } from 'vitest';
import { commands, window, env, workspace, createMockContext } from './vscode.mock';
import { registerCommands } from '../src/commands';

// Mock Ship SDK
vi.mock('@shipstatic/ship', () => ({
  default: vi.fn().mockImplementation(() => ({
    deployments: {
      upload: vi.fn().mockResolvedValue({ deployment: 'happy-cat-abc1234.shipstatic.com' }),
    },
    whoami: vi.fn().mockResolvedValue({ email: 'test@example.com', plan: 'free' }),
  })),
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

    it('deploys with correct SDK args and shows URL', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInformationMessage.mockResolvedValueOnce('Copy URL');

      const mockUpload = vi.fn().mockResolvedValue({ deployment: 'happy-cat-abc1234.shipstatic.com' });
      MockShip.mockImplementationOnce(() => ({ deployments: { upload: mockUpload } }) as any);

      await handlers.get('shipstatic.deploy')!();

      // Verify SDK is constructed with the stored API key
      expect(MockShip).toHaveBeenCalledWith({ apiKey: 'ship-test' });
      // Verify upload is called with selected path and via tracking
      expect(mockUpload).toHaveBeenCalledWith('/test/dist', { via: 'vscode' });
      // Verify URL shown to user
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Deployed to https://happy-cat-abc1234.shipstatic.com',
        'Open in Browser',
        'Copy URL',
      );
      expect(env.clipboard.writeText).toHaveBeenCalledWith('https://happy-cat-abc1234.shipstatic.com');
    });

    it('opens browser when user selects "Open in Browser"', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInformationMessage.mockResolvedValueOnce('Open in Browser');

      await handlers.get('shipstatic.deploy')!();

      expect(env.openExternal).toHaveBeenCalled();
    });

    it('deploys without API key and shows expiry', async () => {
      workspace.workspaceFolders = [{ uri: { fsPath: '/test' } }];
      window.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/test/dist' }]);
      window.showInformationMessage.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
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
      window.showInformationMessage.mockResolvedValueOnce('Set API Key');
      window.showInputBox.mockResolvedValueOnce('ship-newkey');

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
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
      window.showInformationMessage.mockResolvedValueOnce('Set API Key');
      window.showInputBox.mockResolvedValueOnce(undefined);

      const mockUpload = vi.fn().mockResolvedValue({
        deployment: 'happy-cat-abc1234.shipstatic.com',
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
    it('shows account info', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test');

      await handlers.get('shipstatic.whoami')!();

      expect(window.showInformationMessage).toHaveBeenCalledWith('ShipStatic: test@example.com (free)');
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
      expect(window.showInformationMessage).toHaveBeenCalledWith('ShipStatic: test@example.com (free)');
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
