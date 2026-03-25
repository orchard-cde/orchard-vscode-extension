import * as vscode from 'vscode';
import { GroveTreeItem } from './groveTreeItem';
import { GroveManager } from '../services/groveManager';

export class GroveTreeDataProvider implements vscode.TreeDataProvider<GroveTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<GroveTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<GroveTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private readonly _disposable: vscode.Disposable;

  constructor(private readonly groveManager: GroveManager) {
    this._disposable = this.groveManager.onDidChangeGroves(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  getTreeItem(element: GroveTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: GroveTreeItem): GroveTreeItem[] {
    if (element) {
      return [];
    }
    return this.groveManager.getGroves().map((g) => new GroveTreeItem(g));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this._disposable.dispose();
  }
}
