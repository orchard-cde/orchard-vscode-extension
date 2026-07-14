/**
 * Pure utility functions for SSH config construction in connectGrove.
 * Extracted for testability.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Sanitize a grove name into a valid SSH hostname. */
export function sanitizeHostName(name: string): string {
  return 'orchard-' + name.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Convert a WSL /mnt path to a Windows path (e.g., /mnt/c/Users/X → C:\Users\X). */
export function wslPathToWin(wslPath: string): string {
  const parts = wslPath.replace(/^\/mnt\//, '').split('/');
  return parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');
}

/**
 * Filter an SSH config response from the API, removing Host and IdentityFile lines.
 * The caller unconditionally appends correct platform-specific values for both.
 */
export function filterSshConfigLines(sshConfig: string): string[] {
  return sshConfig.trim().split('\n').filter((l) => {
    const trimmed = l.trim();
    return !trimmed.startsWith('Host ') && !trimmed.startsWith('IdentityFile ');
  });
}

/**
 * Build a complete SSH config block with the given hostname and filtered lines.
 * Unconditionally appends the provided IdentityFile path.
 */
export function buildSshConfig(hostName: string, filteredLines: string[], identityFile: string): string {
  return `Host ${hostName}\n${filteredLines.join('\n')}\n  IdentityFile ${identityFile}`;
}

/**
 * Write per-host SSH config and ensure the Include directive is in the main config.
 * Used for the Linux/WSL path.
 */
export async function writeSshConfig(
  sshDir: string,
  hostName: string,
  config: string,
  includeDirective: string,
): Promise<void> {
  const orchardHostsDir = path.join(sshDir, 'orchard_hosts');
  await fs.promises.mkdir(orchardHostsDir, { recursive: true });

  const hostConfigPath = path.join(orchardHostsDir, hostName);
  await fs.promises.writeFile(hostConfigPath, config, { mode: 0o600 });

  const sshConfigPath = path.join(sshDir, 'config');
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
}
