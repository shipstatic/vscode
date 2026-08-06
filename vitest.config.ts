import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * One project. The extension has one runtime (VS Code's Node) and one
 * collaborator (the ship SDK); the tier split ship's suite needs would be
 * several names for the same thing here.
 *
 * The `vscode` module is not installable — it exists only inside the editor —
 * so the alias below is not a convenience, it is the only way this code is
 * testable at all. `tests/vscode.mock.ts` maps 1:1 to the real namespace.
 */
export default defineConfig({
  test: {
    alias: {
      vscode: path.resolve(__dirname, 'tests/vscode.mock.ts'),
    },
    // Mock hygiene as config rather than per-file boilerplate: call history
    // clears before every test, so an assertion can never pass on a previous
    // test's calls.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        // The bundled MCP server's entry point. It runs in a CHILD PROCESS
        // spawned from `dist/`, which V8's in-process coverage cannot observe —
        // so counting it would report 0% for the one file with a dedicated
        // artifact-tier fence (`tests/mcp-entry.test.ts` boots it and asserts
        // its identity and catalogue). Excluded rather than floored at zero:
        // "proven by a tier this instrument cannot see" is a different claim
        // from "untested", and only one of them is true here.
        'src/mcp-entry.ts',
      ],
      /**
       * The 2026-08-06 measurement, held. A ratchet — raised, never lowered.
       *
       * Statements, functions and lines sit at 100 and stay there: four small
       * modules driven through a 1:1 mock of the `vscode` namespace have no
       * in-process blind corner, so a command that arrives without a test
       * fails the run.
       *
       * BRANCHES is 97 for exactly one arm, named rather than rounded away.
       * `auth.ts`'s `validateInput` ends `error instanceof Error ? … : …`, and
       * the else cannot be reached through the real collaborator —
       * `validateToken` throws `ShipError` on every path, and `ShipError` is
       * an Error. Reaching it would mean mocking `@shipstatic/types`, trading
       * a real assertion for a fake one. The arm stays regardless, because a
       * validator returning `undefined` tells VS Code the input is VALID.
       *
       * The per-file floor keeps that gap where it is: `auth.ts` may not decay
       * past the one arm, and no other file may borrow its allowance.
       *
       * NOTE: thresholds catch coverage DECAY. They cannot catch a test that
       * asserts nothing; a tautology neither raises nor lowers coverage.
       */
      thresholds: {
        statements: 100,
        branches: 97,
        functions: 100,
        lines: 100,
        'src/auth.ts': {
          statements: 100,
          branches: 87.5,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
