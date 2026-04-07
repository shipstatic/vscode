import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lm, McpStdioServerDefinition, window, createMockContext } from './vscode.mock';
import { registerMcpProvider, onDidChangeMcpServers } from '../src/mcp';

describe('mcp', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let provider: any;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();

    // Capture the provider passed to registerMcpServerDefinitionProvider
    lm.registerMcpServerDefinitionProvider.mockImplementation((_id: string, p: any) => {
      provider = p;
      return { dispose: () => {} };
    });

    registerMcpProvider(ctx);
  });

  it('registers provider with id "shipstatic"', () => {
    expect(lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith('shipstatic', expect.any(Object));
  });

  it('adds disposables to context subscriptions', () => {
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(1);
  });

  it('exposes onDidChangeMcpServerDefinitions event', () => {
    expect(provider.onDidChangeMcpServerDefinitions).toBeDefined();
  });

  describe('provideMcpServerDefinitions', () => {
    it('returns a server definition without user interaction', async () => {
      const servers = await provider.provideMcpServerDefinitions();

      expect(servers).toHaveLength(1);
      expect(servers[0]).toBeInstanceOf(McpStdioServerDefinition);
      expect(servers[0].label).toBe('ShipStatic');
      expect(servers[0].args[0]).toContain('mcp-server.js');
      // Must NOT prompt for API key
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('uses process.execPath as command', async () => {
      const servers = await provider.provideMcpServerDefinitions();
      expect(servers[0].command).toBe(process.execPath);
    });
  });

  describe('resolveMcpServerDefinition', () => {
    it('sets SHIP_API_KEY env from SecretStorage', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-test123');
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      expect(resolved).toBe(server);
      expect(resolved.env.SHIP_API_KEY).toBe('ship-test123');
    });

    it('starts without API key when none stored', async () => {
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      expect(resolved).toBe(server);
      expect(resolved.env.SHIP_API_KEY).toBeUndefined();
      expect(window.showInputBox).not.toHaveBeenCalled();
    });
  });

  describe('onDidChangeMcpServers', () => {
    it('fires event that triggers provider re-query', () => {
      let fired = false;
      provider.onDidChangeMcpServerDefinitions(() => { fired = true; });

      onDidChangeMcpServers.fire();

      expect(fired).toBe(true);
    });
  });
});
