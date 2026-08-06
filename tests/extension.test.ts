import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, deactivate } from '../src/extension';
import { _statusBarItem, commands, createMockContext, lm, window } from './vscode.mock';

vi.mock('@shipstatic/ship', () => ({ default: vi.fn() }));

const KEY = 'shipstatic.token';
const LEGACY_KEY = 'shipstatic.apiKey';
const STORED = `ship-${'a'.repeat(64)}`;

/**
 * @file The activation wiring — what every other test file assumes has run.
 *
 * `extension.ts` had no mirror until 1.0.0, which is exactly backwards: it is
 * the file that decides what exists and, since the one-slot migration, WHEN.
 */
describe('activate', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
    commands.registerCommand.mockImplementation(() => ({ dispose: () => {} }));
    lm.registerMcpServerDefinitionProvider.mockImplementation(() => ({ dispose: () => {} }));
  });

  it('registers the MCP provider under the id the manifest contributes', async () => {
    await activate(ctx);

    expect(lm.registerMcpServerDefinitionProvider).toHaveBeenCalledWith(
      'shipstatic',
      expect.any(Object),
    );
  });

  it('registers every contributed command', async () => {
    await activate(ctx);

    const registered = commands.registerCommand.mock.calls.map((c: any[]) => c[0]);
    expect(registered.sort()).toEqual([
      'shipstatic.deploy',
      'shipstatic.deployWithPassword',
      'shipstatic.setToken',
      'shipstatic.whoami',
    ]);
  });

  it('shows the status bar item', async () => {
    await activate(ctx);

    expect(window.createStatusBarItem).toHaveBeenCalled();
    expect(_statusBarItem.show).toHaveBeenCalled();
  });

  it('registers everything as a disposable', async () => {
    await activate(ctx);

    // Provider + emitter + four commands + status bar item.
    expect(ctx.subscriptions.length).toBe(7);
  });

  describe('the 0.2.x secret migration', () => {
    it('moves a stored credential onto the one-slot key', async () => {
      await ctx.secrets.store(LEGACY_KEY, STORED);

      await activate(ctx);

      expect(await ctx.secrets.get(KEY)).toBe(STORED);
      expect(await ctx.secrets.get(LEGACY_KEY)).toBeUndefined();
    });

    it('completes BEFORE the MCP provider is registered', async () => {
      // The ordering fence, and the reason `activate` is async at all. VS Code
      // queries the provider as soon as the extension is active; a migration
      // racing that would hand the agent an anonymous server while the user's
      // token sat one key over. Call order, not wall-clock — the only thing
      // that can state "before" without being flaky.
      await ctx.secrets.store(LEGACY_KEY, STORED);

      await activate(ctx);

      const migratedAt = ctx.secrets.store.mock.invocationCallOrder[0];
      const registeredAt = lm.registerMcpServerDefinitionProvider.mock.invocationCallOrder[0];
      expect(migratedAt).toBeLessThan(registeredAt);
    });

    it('leaves a clean install untouched', async () => {
      await activate(ctx);

      expect(ctx.secrets.store).not.toHaveBeenCalled();
      expect(ctx.secrets.delete).not.toHaveBeenCalled();
    });
  });
});

describe('deactivate', () => {
  it('has nothing to undo — every resource is a context subscription', () => {
    expect(deactivate()).toBeUndefined();
  });
});
