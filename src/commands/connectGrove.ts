import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { GroveResponse } from '../api/types';
import { ITrellisClient } from '../api/trellisClient';
import * as logger from '../util/logger';
import { sanitizeHostName, wslPathToWin, filterSshConfigLines, buildSshConfig, writeSshConfig } from './connectGroveUtils';

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
  const tmpContentWsl = path.join(winTmp, `orchard-ssh-${hostName}.txt`);
  const tmpScriptWsl = path.join(winTmp, `orchard-ssh-${hostName}.ps1`);
  const hostFile = `${winDir}\\orchard_hosts\\${hostName}`;

  // Write content to WSL-accessible path
  await fs.promises.writeFile(tmpContentWsl, content, 'utf-8');

  // Convert WSL paths to Windows paths for PowerShell
  const tmpContentWin = wslPathToWin(tmpContentWsl);
  const tmpScriptWin = wslPathToWin(tmpScriptWsl);

  const psLines = [
    `$hostFile = "${hostFile}"`,
    `$contentFile = "${tmpContentWin}"`,
    '$hostDir = Split-Path $hostFile -Parent',
    'if (!(Test-Path $hostDir)) { New-Item -ItemType Directory -Path $hostDir -Force | Out-Null }',
    'if (Test-Path $hostFile) { Remove-Item $hostFile -Force }',
    'Copy-Item -Path $contentFile -Destination $hostFile',
    '$u = whoami',
    'icacls $hostFile /inheritance:r /grant ("${u}:(R)")',
    'Write-Output "OK"',
  ];
  await fs.promises.writeFile(tmpScriptWsl, psLines.join('\n'), 'utf-8');

  try {
    await new Promise<void>((resolve, reject) => {
      exec(
        `powershell.exe -ExecutionPolicy Bypass -File "${tmpScriptWin}"`,
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
    try { await fs.promises.unlink(tmpScriptWsl); } catch { /* ok */ }
    try { await fs.promises.unlink(tmpContentWsl); } catch { /* ok */ }
  }
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

export async function connectGrove(grove: GroveResponse, trellisClient: ITrellisClient): Promise<void> {
  try {
    // Fetch SSH config from the API
    const sshConfig = await trellisClient.getSshConfig(grove.id);

    // Sanitize grove name for SSH host
    const hostName = sanitizeHostName(grove.name);

    // Filter out Host and IdentityFile from the API response — we unconditionally
    // append correct platform-specific values for both below
    const filteredLines = filterSshConfigLines(sshConfig);

    const includeDirective = 'Include orchard_hosts/*';

    // Linux/WSL config: unconditional IdentityFile with WSL path
    const linuxIdentityFile = path.join(os.homedir(), '.ssh', 'orchard_ed25519');
    const fullConfig = buildSshConfig(hostName, filteredLines, linuxIdentityFile);
    await writeSshConfig(path.join(os.homedir(), '.ssh'), hostName, fullConfig, includeDirective);

    // On WSL, also write to Windows SSH config
    if (isWsl()) {
      const wslSshDir = findWindowsSshDir();
      if (wslSshDir) {
        const winSshDir = wslPathToWin(wslSshDir);
        const winKeyPath = path.join(wslSshDir, 'orchard_ed25519');
        const winKeyWinPath = wslPathToWin(winKeyPath);

        // Always copy SSH key from WSL to Windows (prevents stale key issues)
        const wslKeyPath = path.join(os.homedir(), '.ssh', 'orchard_ed25519');
        if (fs.existsSync(wslKeyPath)) {
          await fs.promises.copyFile(wslKeyPath, winKeyPath);
          logger.debug(`connectGrove: copied SSH key to Windows: ${winKeyPath}`);
        } else {
          logger.warn(`connectGrove: WSL key not found: ${wslKeyPath}`);
        }

        // Fix key file permissions (SSH requires strict ACLs on private keys)
        if (fs.existsSync(winKeyPath)) {
          try {
            const icaclsOutput = await new Promise<string>((resolve, reject) => {
              exec(
                `icacls.exe "${winKeyWinPath}" /inheritance:r /grant "STEVEN-PC\\Steven Tompkins:(R)"`,
                { timeout: 10000 },
                (err, stdout, stderr) => {
                  if (err) { reject(new Error(stderr || err.message)); } else { resolve(stdout || ''); }
                },
              );
            });
            logger.debug(`connectGrove: icacls OK: ${icaclsOutput.trim()}`);
          } catch (e) {
            logger.warn(`connectGrove: failed to fix key permissions: ${e}`);
          }
        } else {
          logger.warn(`connectGrove: SSH key does not exist on Windows: ${winKeyPath}`);
        }

        // Windows config: unconditional IdentityFile with Windows path
        const winIdentityFile = `"${winSshDir}\\orchard_ed25519"`;
        const winConfig = buildSshConfig(hostName, filteredLines, winIdentityFile);
        await writeWindowsSshConfig(winSshDir, hostName, winConfig);

        // Ensure Include directive is in Windows main SSH config
        const winMainConfigPath = path.join(wslSshDir, 'config');
        let winMainConfig = '';
        try {
          winMainConfig = await fs.promises.readFile(winMainConfigPath, 'utf-8');
        } catch {
          // File may not exist yet
        }
        logger.debug(`connectGrove WIN-SSH: main config path=${winMainConfigPath}`);
        if (!winMainConfig.includes(includeDirective)) {
          const newWinConfig = includeDirective + '\n\n' + winMainConfig;
          await fs.promises.writeFile(winMainConfigPath, newWinConfig, { mode: 0o600 });
          logger.debug(`connectGrove WIN-SSH: added Include directive`);
        }
        // Read back the host config file to confirm
        const winHostConfigPath = path.join(wslSshDir, 'orchard_hosts', hostName);
        try {
          const written = await fs.promises.readFile(winHostConfigPath, 'utf-8');
          logger.debug(`connectGrove WIN-SSH: host config written:\n${written}`);
        } catch (e) {
          logger.warn(`connectGrove WIN-SSH: could not read host config: ${e}`);
        }

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
