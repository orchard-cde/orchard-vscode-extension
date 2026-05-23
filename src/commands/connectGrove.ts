import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { GroveResponse } from '../api/types';
import { TrellisClient } from '../api/trellisClient';
import * as logger from '../util/logger';

function isWsl(): boolean {
  return os.release().toLowerCase().includes('microsoft');
}

/** Get Windows temp directory path from WSL. */
async function getWindowsTempDir(): Promise<string | undefined> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      exec('cmd.exe /c echo %TEMP%', { timeout: 5000 }, (err, stdout) => {
        if (err) { reject(err); } else { resolve(stdout); }
      });
    });
    const lines = stdout.split('\n').filter((l) => l.includes(':\\'));
    if (lines.length > 0) {
      const winPath = lines[0].trim();
      return '/mnt/' + winPath[0].toLowerCase() + winPath.slice(2).replace(/\\/g, '/');
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Write SSH config to Windows filesystem with correct permissions via PowerShell. */
async function writeWindowsSshConfig(winDir: string, hostName: string, content: string): Promise<void> {
  const winTmp = (await getWindowsTempDir()) || '/tmp';
  const tmpContent = path.join(winTmp, `orchard-ssh-${hostName}.txt`);
  const tmpScript = path.join(winTmp, `orchard-ssh-${hostName}.ps1`);
  const hostFile = `${winDir}\\orchard_hosts\\${hostName}`;

  await fs.promises.writeFile(tmpContent, content, 'utf-8');

  const psLines = [
    `$hostFile = "${hostFile}"`,
    `$contentFile = "${tmpContent}"`,
    '$hostDir = Split-Path $hostFile -Parent',
    'if (!(Test-Path $hostDir)) { New-Item -ItemType Directory -Path $hostDir -Force | Out-Null }',
    'if (Test-Path $hostFile) { Remove-Item $hostFile -Force }',
    'Copy-Item -Path $contentFile -Destination $hostFile',
    '$u = whoami',
    'icacls $hostFile /inheritance:r /grant ("${u}:(R)")',
    'Write-Output "OK"',
  ];
  await fs.promises.writeFile(tmpScript, psLines.join('\n'), 'utf-8');

  try {
    await new Promise<void>((resolve, reject) => {
      exec(
        `powershell.exe -ExecutionPolicy Bypass -File "${tmpScript}"`,
        { timeout: 30000 },
        (err, stdout, stderr) => {
          const combined = (stdout || '') + (stderr || '');
          if (err && !combined.includes('OK')) {
            reject(new Error(combined.trim() || err.message));
          } else {
            logger.info(`writeWindowsSshConfig: OK`);
            resolve();
          }
        },
      );
    });
  } finally {
    try { await fs.promises.unlink(tmpScript); } catch { /* ok */ }
    try { await fs.promises.unlink(tmpContent); } catch { /* ok */ }
  }
}

/** Convert a WSL /mnt path to a Windows path (e.g., /mnt/c/Users/X → C:\Users\X). */
function wslPathToWin(wslPath: string): string {
  const parts = wslPath.replace(/^\/mnt\//, '').split('/');
  return parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');
}

/** Find the Windows user's .ssh directory from WSL by scanning /mnt/c/Users/. */
function findWindowsSshDir(): string | undefined {
  try {
    const usersDir = '/mnt/c/Users';
    if (!fs.existsSync(usersDir)) {
      logger.info('connectGrove: /mnt/c/Users not found, skipping Windows SSH config');
      return undefined;
    }
    const entries = fs.readdirSync(usersDir, { withFileTypes: true });
    // Find the first real user directory with a .ssh folder
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const name = entry.name;
      if (name === 'Default' || name === 'Public' || name === 'All Users' || name === 'WsiAccount' || name === 'defaultuser0') {
        continue;
      }
      const sshDir = path.join(usersDir, name, '.ssh');
      if (fs.existsSync(sshDir)) {
        logger.info(`connectGrove: found Windows SSH dir: ${sshDir}`);
        return sshDir;
      }
    }
    // Fallback: use first non-system user directory
    for (const entry of entries) {
      if (!entry.isDirectory()) { continue; }
      const name = entry.name;
      if (name === 'Default' || name === 'Public' || name === 'All Users' || name === 'WsiAccount' || name === 'defaultuser0') {
        continue;
      }
      const sshDir = path.join(usersDir, name, '.ssh');
      logger.info(`connectGrove: creating Windows SSH dir: ${sshDir}`);
      return sshDir;
    }
    logger.info('connectGrove: no suitable Windows user directory found');
  } catch (err) {
    logger.warn(`connectGrove: error finding Windows SSH dir: ${err}`);
  }
  return undefined;
}

function sanitizeHostName(name: string): string {
  return 'orchard-' + name.replace(/[^a-zA-Z0-9-]/g, '-');
}

async function writeSshConfig(
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

export async function connectGrove(grove: GroveResponse, trellisClient: TrellisClient): Promise<void> {
  try {
    // Fetch SSH config from the API
    const sshConfig = await trellisClient.getSshConfig(grove.id);

    // Sanitize grove name for SSH host
    const hostName = sanitizeHostName(grove.name);

    // Append IdentityFile if not already present
    const identityFile = path.join(os.homedir(), '.ssh', 'orchard_ed25519');
    const configLines = sshConfig.trim().split('\n');
    const hasIdentityFile = configLines.some((l) => l.trim().startsWith('IdentityFile'));
    const fullConfig = hasIdentityFile ? sshConfig : sshConfig + `\n  IdentityFile ${identityFile}`;

    const includeDirective = 'Include orchard_hosts/*';

    // Write to Linux/WSL SSH config
    await writeSshConfig(path.join(os.homedir(), '.ssh'), hostName, fullConfig, includeDirective);

    // On WSL, also write to Windows SSH config
    if (isWsl()) {
      const wslSshDir = findWindowsSshDir();
      if (wslSshDir) {
        const winSshDir = wslPathToWin(wslSshDir);
        const winKeyPath = path.join(wslSshDir, 'orchard_ed25519');

        // Copy SSH key from WSL to Windows if needed
        const wslKeyPath = path.join(os.homedir(), '.ssh', 'orchard_ed25519');
        if (fs.existsSync(wslKeyPath) && !fs.existsSync(winKeyPath)) {
          await fs.promises.copyFile(wslKeyPath, winKeyPath);
          logger.info(`connectGrove: copied SSH key to Windows: ${winKeyPath}`);
        }
        // Fix key file permissions (SSH requires strict ACLs on private keys)
        if (fs.existsSync(winKeyPath)) {
          const winKeyWinPath = winKeyPath.replace(/\//g, '\\');
          try {
            await new Promise<void>((resolve, reject) => {
              exec(
                `icacls.exe "${winKeyWinPath}" /inheritance:r /grant "STEVEN-PC\\Steven Tompkins:(R)"`,
                { timeout: 10000 },
                (err) => { if (err) reject(err); else resolve(); },
              );
            });
          } catch (e) {
            logger.warn(`connectGrove: failed to fix key permissions: ${e}`);
          }
        }

        const winIdentityFile = `"${winSshDir}\\orchard_ed25519"`;
        const winConfig = hasIdentityFile ? sshConfig : sshConfig + `\n  IdentityFile ${winIdentityFile}`;
        await writeWindowsSshConfig(winSshDir, hostName, winConfig);
        logger.info(`connectGrove: wrote SSH config to Windows: ${winSshDir}`);
      } else {
        logger.warn('connectGrove: could not find Windows SSH dir to write config');
      }
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
