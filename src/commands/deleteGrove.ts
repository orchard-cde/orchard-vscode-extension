import * as vscode from 'vscode';
import { GroveResponse } from '../api/types';
import { GroveManager } from '../services/groveManager';

export async function deleteGrove(grove: GroveResponse, groveManager: GroveManager): Promise<void> {
  const confirmed = await vscode.window.showWarningMessage(
    `Are you sure you want to delete grove '${grove.name}'?`,
    { modal: true },
    'Delete',
  );

  if (confirmed !== 'Delete') {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deleting grove '${grove.name}'...` },
    async () => {
      await groveManager.deleteGrove(grove.id);
      vscode.window.showInformationMessage(`Grove '${grove.name}' has been deleted`);
    },
  );
}
