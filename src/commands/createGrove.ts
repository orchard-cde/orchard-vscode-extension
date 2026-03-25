import * as vscode from 'vscode';
import { GroveManager } from '../services/groveManager';
import { MACHINE_SIZES } from '../models/grove';

export async function createGrove(groveManager: GroveManager): Promise<void> {
  // Step 1: Repository URL
  const repositoryUrl = await vscode.window.showInputBox({
    prompt: 'Repository URL',
    placeHolder: 'https://github.com/org/repo',
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Repository URL is required';
      }
      return undefined;
    },
  });
  if (!repositoryUrl) {
    return;
  }

  // Step 2: Branch
  const branch = await vscode.window.showInputBox({
    prompt: 'Branch',
    value: 'main',
  });
  if (branch === undefined) {
    return;
  }

  // Step 3: Name (optional, auto-suggest from repo name)
  let suggestedName = '';
  try {
    const url = new URL(repositoryUrl);
    const parts = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    suggestedName = parts[parts.length - 1] || '';
  } catch {
    // ignore invalid URL for name suggestion
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Grove Name (optional)',
    placeHolder: suggestedName || 'my-grove',
  });
  if (name === undefined) {
    return;
  }

  // Step 4: Machine Size
  const sizeChoice = await vscode.window.showQuickPick(MACHINE_SIZES, {
    placeHolder: 'Select machine size',
  });
  if (!sizeChoice) {
    return;
  }

  // Create the grove with progress
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Planting grove...' },
    async () => {
      const grove = await groveManager.createGrove({
        repositoryUrl,
        branch: branch || 'main',
        name: name || undefined,
        machineSize: sizeChoice.value,
      });
      vscode.window.showInformationMessage(`Grove '${grove.name}' is being planted`);
    },
  );
}
