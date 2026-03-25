import * as vscode from 'vscode';
import { GroveResponse } from '../api/types';
import { stateDisplayLabel } from '../models/grove';

export async function showGroveDetails(grove: GroveResponse): Promise<void> {
  const lines: string[] = [];
  lines.push(`Name: ${grove.name}`);
  lines.push(`State: ${stateDisplayLabel(grove.state)}`);
  lines.push(`Repository: ${grove.repositoryUrl}`);
  lines.push(`Branch: ${grove.branch}`);

  if (grove.seedling) {
    lines.push(`Machine: ${grove.seedling.cpuCores} CPU, ${grove.seedling.memoryMb} MB RAM, ${grove.seedling.diskGb} GB Disk`);
  }

  await vscode.window.showInformationMessage(lines.join(' | '));
}
