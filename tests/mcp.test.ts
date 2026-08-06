import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onDidChangeMcpServers, registerMcpProvider } from '../src/mcp';
import { createMockContext, lm, McpStdioServerDefinition, window } from './vscode.mock';

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
    expect(lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith(
      'shipstatic',
      expect.any(Object),
    );
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
      // Must NOT prompt for a credential
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('uses process.execPath as command', async () => {
      const servers = await provider.provideMcpServerDefinitions();
      expect(servers[0].command).toBe(process.execPath);
    });
  });

  describe('resolveMcpServerDefinition', () => {
    it('sets SHIP_TOKEN from SecretStorage', async () => {
      await ctx.secrets.store('shipstatic.token', 'ship-test123');
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      expect(resolved).toBe(server);
      expect(resolved.env.SHIP_TOKEN).toBe('ship-test123');
    });

    it('forwards a deploy token through the same slot', async () => {
      // The extension never classifies the credential — it carries whatever
      // the user stored, and the server decides what it is.
      await ctx.secrets.store('shipstatic.token', `deploy-${'b'.repeat(64)}`);
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      expect(resolved.env.SHIP_TOKEN).toBe(`deploy-${'b'.repeat(64)}`);
    });

    it('starts without a token when none is stored', async () => {
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      expect(resolved).toBe(server);
      expect(resolved.env.SHIP_TOKEN).toBeNull();
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('states the SDK’s whole env contract, so SecretStorage is the sole source', async () => {
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      // Exactly the two variables the SDK reads, both explicitly nulled: a
      // credential exported for CLI use cannot authenticate an "anonymous"
      // agent deploy, and an exported endpoint cannot redirect one. Exact
      // equality is the fence — an SDK that grows a third variable must be
      // met here, and a fourth null for something nothing reads is noise that
      // reads like protection.
      expect(resolved.env).toEqual({
        SHIP_TOKEN: null,
        SHIP_API_URL: null,
      });
    });

    it('leaves a definition it did not provide untouched', async () => {
      // This provider only ever provides stdio definitions, so the narrowing in
      // `resolveMcpServerDefinition` states a guarantee rather than handling a
      // case. Should VS Code ever hand back another kind, it comes back
      // unmodified — never credentialed on the assumption it takes an env.
      const foreign = { label: 'ShipStatic' } as any;

      const resolved = await provider.resolveMcpServerDefinition(foreign);

      expect(resolved).toBe(foreign);
      expect(resolved.env).toBeUndefined();
    });

    it('no longer speaks the retired credential vocabulary', async () => {
      const server = new McpStdioServerDefinition('ShipStatic', 'node', []);

      const resolved = await provider.resolveMcpServerDefinition(server);

      // SHIP_API_KEY / SHIP_DEPLOY_TOKEN are read by nothing since ship 2.0.
      expect(resolved.env).not.toHaveProperty('SHIP_API_KEY');
      expect(resolved.env).not.toHaveProperty('SHIP_DEPLOY_TOKEN');
    });
  });

  describe('onDidChangeMcpServers', () => {
    it('fires event that triggers provider re-query', () => {
      let fired = false;
      provider.onDidChangeMcpServerDefinitions(() => {
        fired = true;
      });

      onDidChangeMcpServers.fire();

      expect(fired).toBe(true);
    });
  });
});
