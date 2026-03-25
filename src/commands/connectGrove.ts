import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GroveResponse } from '../api/types';
import { TrellisClient } from '../api/trellisClient';

export async function connectGrove(grove: GroveResponse, trellisClient: TrellisClient): Promise<void> {
  try {
    // Fetch SSH config from the API
    const sshConfig = await trellisClient.getSshConfig(grove.id);

    // Sanitize grove name for SSH host
    const hostName = 'orchard-' + grove.name.replace(/[^a-zA-Z0-9-]/g, '-');

    // Ensure ~/.ssh/orchard_hosts/ directory exists
    const sshDir = path.join(os.homedir(), '.ssh');
    const orchardHostsDir = path.join(sshDir, 'orchard_hosts');
    await fs.promises.mkdir(orchardHostsDir, { recursive: true });

    // Write SSH config for this grove
    const hostConfigPath = path.join(orchardHostsDir, hostName);
    await fs.promises.writeFile(hostConfigPath, sshConfig, { mode: 0o600 });

    // Ensure ~/.ssh/config includes orchard_hosts/*
    const sshConfigPath = path.join(sshDir, 'config');
    const includeDirective = 'Include orchard_hosts/*';

    let existingConfig = '';
    try {
      existingConfig = await fs.promises.readFile(sshConfigPath, 'utf-8');
    } catch {
      // File may not exist yet
    }

    if (!existingConfig.includes(includeDirective)) {
      const newConfig = includeDirective + '\n\n' + existingConfig;
      await fs.promises.writeFile(sshConfigPath, newConfig, { mode: 0o600 });
    }

    // Launch Remote SSH
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.parse(`vscode-remote://ssh-remote+${hostName}/home/cultivator`),
      { forceNewWindow: true },
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to connect to grove '${grove.name}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
