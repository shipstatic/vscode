import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToken, migrateSecret, setToken } from '../src/auth';
import { createMockContext, window } from './vscode.mock';

/** 69 chars: `ship-` + 64 hex — passes the platform's own validator. */
const API_KEY = `ship-${'a'.repeat(64)}`;
/** 71 chars: `deploy-` + 64 hex. The other half of the one slot. */
const DEPLOY_TOKEN = `deploy-${'b'.repeat(64)}`;

const KEY = 'shipstatic.token';
const LEGACY_KEY = 'shipstatic.apiKey';

describe('auth', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
  });

  describe('getToken', () => {
    it('returns the stored token', async () => {
      await ctx.secrets.store(KEY, API_KEY);
      expect(await getToken(ctx)).toBe(API_KEY);
    });

    it('returns undefined when nothing is stored', async () => {
      expect(await getToken(ctx)).toBeUndefined();
    });

    it('does not fall back to the 0.2.x key', async () => {
      // Migration is activation's job, once. A lazy fallback here would be a
      // second reader of a key this version is meant to be rid of.
      await ctx.secrets.store(LEGACY_KEY, API_KEY);
      expect(await getToken(ctx)).toBeUndefined();
    });
  });

  describe('setToken', () => {
    it('stores the token from the input box and returns it', async () => {
      window.showInputBox.mockResolvedValueOnce(API_KEY);

      const result = await setToken(ctx);

      expect(result).toBe(API_KEY);
      expect(ctx.secrets.store).toHaveBeenCalledWith(KEY, API_KEY);
    });

    it('returns undefined when the user cancels', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);

      const result = await setToken(ctx);

      expect(result).toBeUndefined();
      expect(ctx.secrets.store).not.toHaveBeenCalledWith(KEY, expect.anything());
    });

    it('masks the input and survives focus loss', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setToken(ctx);

      const opts = window.showInputBox.mock.calls[0][0];
      expect(opts.password).toBe(true);
      expect(opts.ignoreFocusOut).toBe(true);
    });

    it('offers both credential shapes in the placeholder — one slot takes either', async () => {
      window.showInputBox.mockResolvedValueOnce(undefined);
      await setToken(ctx);

      const opts = window.showInputBox.mock.calls[0][0];
      expect(opts.placeHolder).toContain('ship-');
      expect(opts.placeHolder).toContain('deploy-');
    });

    describe('validateInput — the platform validator, not a local rule', () => {
      /** The validator the input box was configured with, for a cancelled prompt. */
      async function validator() {
        window.showInputBox.mockResolvedValueOnce(undefined);
        await setToken(ctx);
        return window.showInputBox.mock.calls[0][0].validateInput as (v: string) => string | null;
      }

      it('accepts a well-formed API key', async () => {
        expect((await validator())(API_KEY)).toBeNull();
      });

      it('accepts a well-formed deploy token', async () => {
        // The break this version exists for: 0.2.x rejected everything that
        // was not a `ship-` key, so the second credential population the
        // platform issues could not be entered at all.
        expect((await validator())(DEPLOY_TOKEN)).toBeNull();
      });

      it('accepts an opaque bearer, whose validity is the server’s to decide', async () => {
        expect((await validator())('an-oauth-access-token')).toBeNull();
      });

      it('rejects a malformed API key by its own rule', async () => {
        expect((await validator())('ship-tooshort')).toContain('characters');
      });

      it('rejects a malformed deploy token by its own rule', async () => {
        expect((await validator())('deploy-tooshort')).toContain('characters');
      });

      it('rejects an empty value', async () => {
        expect((await validator())('')).toBeTruthy();
      });
    });
  });

  describe('migrateSecret', () => {
    it('moves a 0.2.x credential onto the one-slot key and drops the old one', async () => {
      await ctx.secrets.store(LEGACY_KEY, API_KEY);

      await migrateSecret(ctx);

      expect(await ctx.secrets.get(KEY)).toBe(API_KEY);
      expect(await ctx.secrets.get(LEGACY_KEY)).toBeUndefined();
    });

    it('touches nothing when there is no 0.2.x credential', async () => {
      await migrateSecret(ctx);

      expect(ctx.secrets.store).not.toHaveBeenCalled();
      expect(ctx.secrets.delete).not.toHaveBeenCalled();
    });

    it('keeps the newer credential when both keys hold one', async () => {
      // The old key can only have been written by a version that predates the
      // new one, so it is never the fresher of the two.
      await ctx.secrets.store(LEGACY_KEY, API_KEY);
      await ctx.secrets.store(KEY, DEPLOY_TOKEN);

      await migrateSecret(ctx);

      expect(await ctx.secrets.get(KEY)).toBe(DEPLOY_TOKEN);
      expect(await ctx.secrets.get(LEGACY_KEY)).toBeUndefined();
    });

    it('is idempotent — a second activation has nothing left to do', async () => {
      await ctx.secrets.store(LEGACY_KEY, API_KEY);
      await migrateSecret(ctx);
      vi.clearAllMocks();

      await migrateSecret(ctx);

      expect(ctx.secrets.store).not.toHaveBeenCalled();
      expect(ctx.secrets.delete).not.toHaveBeenCalled();
    });
  });
});
