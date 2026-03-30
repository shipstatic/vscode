import * as vscode from 'vscode';

export function createStatusBarItem(context: vscode.ExtensionContext) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(cloud-upload) ShipStatic';
  item.tooltip = 'Deploy to ShipStatic';
  item.command = 'shipstatic.deploy';
  item.show();
  context.subscriptions.push(item);
}
