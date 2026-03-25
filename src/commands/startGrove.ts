import * as vscode from 'vscode';
import { GroveResponse } from '../api/types';
import { GroveManager } from '../services/groveManager';

export async function startGrove(grove: GroveResponse, groveManager: GroveManager): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Starting grove '${grove.name}'...` },
    async () => {
      await groveManager.startGrove(grove.id);
      vscode.window.showInformationMessage(`Grove '${grove.name}' is being started`);
    },
  );
}
