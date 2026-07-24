import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      vscode: path.resolve(__dirname, 'tests/vscode.mock.ts'),
    },
  },
});
