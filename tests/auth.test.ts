import { describe, it, expect, vi, beforeEach } from 'vitest';
import { window, createMockContext } from './vscode.mock';
import { getApiKey, setApiKey } from '../src/auth';

const VALID_KEY = 'ship-' + 'a'.repeat(64); // 69 chars, matches API_KEY.TOTAL_LENGTH

describe('auth', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  describe('getApiKey', () => {
    it('returns stored key', async () => {
      await ctx.secrets.store('shipstatic.apiKey', VALID_KEY);
      expect(await getApiKey(ctx)).toBe(VALID_KEY);
    });

    it('returns undefined when no key stored', async () => {
      expect(await getApiKey(ctx)).toBeUndefined();
    });
  });

  describe('setApiKey', () => {
    it('stores key from input box and returns it', async () => {
      window.showInputBox.mockResolvedValueOnce(VALID_KEY);

      const result = await setApiKey(ctx);

      expect(result).toBe(VALID_KEY);
      expect(ctx.secrets.store).toHaveBeenCalledWith('shipstatic.apiKey', VALID_KEY);
    });

    it('returns undefined when user cancels', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      const result = await setApiKey(ctx);

      expect(result).toBeUndefined();
      expect(ctx.secrets.store).not.toHaveBeenCalledWith('shipstatic.apiKey', expect.anything());
    });

    it('configures input box correctly', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setApiKey(ctx);

      const opts = window.showInputBox.mock.calls[0][0];
      expect(opts.password).toBe(true);
      expect(opts.ignoreFocusOut).toBe(true);
      expect(opts.placeHolder).toMatch(/^ship-/);
    });

    it('accepts a key with valid prefix and length', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setApiKey(ctx);

      const validate = window.showInputBox.mock.calls[0][0].validateInput;
      expect(validate(VALID_KEY)).toBeNull();
    });

    it('rejects key without ship- prefix', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setApiKey(ctx);

      const validate = window.showInputBox.mock.calls[0][0].validateInput;
      const message = validate('token-' + 'a'.repeat(64));
      expect(message).toContain('ship-');
    });

    it('rejects key with wrong length', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setApiKey(ctx);

      const validate = window.showInputBox.mock.calls[0][0].validateInput;
      const message = validate('ship-tooshort');
      expect(message).toContain('characters');
    });
  });
});
