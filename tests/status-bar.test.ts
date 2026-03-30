import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _statusBarItem, createMockContext } from './vscode.mock';
import { createStatusBarItem } from '../src/status-bar';

describe('status-bar', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
    vi.clearAllMocks();
    _statusBarItem.text = '';
    _statusBarItem.tooltip = '';
    _statusBarItem.command = '';
  });

  it('creates item with correct properties', () => {
    createStatusBarItem(ctx);

    expect(_statusBarItem.text).toBe('$(cloud-upload) ShipStatic');
    expect(_statusBarItem.tooltip).toBe('Deploy to ShipStatic');
    expect(_statusBarItem.command).toBe('shipstatic.deploy');
  });

  it('shows the item', () => {
    createStatusBarItem(ctx);
    expect(_statusBarItem.show).toHaveBeenCalled();
  });

  it('adds item to subscriptions for disposal', () => {
    createStatusBarItem(ctx);
    expect(ctx.subscriptions.length).toBe(1);
  });
});
