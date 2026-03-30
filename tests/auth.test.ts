import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, createMockContext } from './vscode.mock';
import { getApiKey, setApiKey, ensureApiKey } from '../src/auth';

describe('auth', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  describe('getApiKey', () => {
    it('returns stored key', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-abc123');
      expect(await getApiKey(ctx)).toBe('ship-abc123');
    });

    it('returns undefined when no key stored', async () => {
      expect(await getApiKey(ctx)).toBeUndefined();
    });
  });

  describe('setApiKey', () => {
    it('stores key from input box and returns it', async () => {
      window.showInputBox.mockResolvedValueOnce('ship-newkey');

      const result = await setApiKey(ctx);

      expect(result).toBe('ship-newkey');
      expect(ctx.secrets.store).toHaveBeenCalledWith('shipstatic.apiKey', 'ship-newkey');
    });

    it('returns undefined when user cancels', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      const result = await setApiKey(ctx);

      expect(result).toBeUndefined();
      expect(ctx.secrets.store).not.toHaveBeenCalledWith('shipstatic.apiKey', expect.anything());
    });

    it('shows password input with validation', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setApiKey(ctx);

      const opts = window.showInputBox.mock.calls[0][0];
      expect(opts.password).toBe(true);
      expect(opts.ignoreFocusOut).toBe(true);
      expect(opts.validateInput('ship-valid')).toBeNull();
      expect(opts.validateInput('bad')).toContain('ship-');
    });
  });

  describe('ensureApiKey', () => {
    it('returns existing key without prompting', async () => {
      await ctx.secrets.store('shipstatic.apiKey', 'ship-existing');

      const result = await ensureApiKey(ctx);

      expect(result).toBe('ship-existing');
      expect(window.showInputBox).not.toHaveBeenCalled();
    });

    it('prompts when no key stored', async () => {
      window.showInputBox.mockResolvedValueOnce('ship-prompted');

      const result = await ensureApiKey(ctx);

      expect(result).toBe('ship-prompted');
      expect(window.showInputBox).toHaveBeenCalledOnce();
    });
  });
});
