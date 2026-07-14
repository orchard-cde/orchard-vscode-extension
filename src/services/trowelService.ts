import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getTrowelPath } from '../util/configuration';
import * as logger from '../util/logger';

export class TrowelService {
  private globalStoragePath: string | undefined;

  constructor(globalStoragePath?: string) {
    this.globalStoragePath = globalStoragePath;
  }

  /**
   * Finds the Trowel CLI binary by checking:
   * 1. The orchard.trowelPath setting
   * 2. VS Code globalStoragePath (auto-updated location)
   * 3. The system PATH via `which trowel`
   * 4. ~/.orchard/bin/trowel
   *
   * Returns the path if found, undefined if not.
   */
  async detectTrowel(): Promise<string | undefined> {
    // 1. Check configured setting
    const configuredPath = getTrowelPath();
    if (configuredPath) {
      if (fs.existsSync(configuredPath)) {
        logger.info(`Trowel CLI found at configured path: ${configuredPath}`);
        return configuredPath;
      }
      logger.warn(`Configured trowelPath does not exist: ${configuredPath}`);
    }

    // 2. Check VS Code globalStorage (auto-updated location takes precedence over PATH)
    if (this.globalStoragePath) {
      const storagePath = path.join(this.globalStoragePath, 'bin', 'trowel');
      if (fs.existsSync(storagePath)) {
        logger.info(`Trowel CLI found at globalStorage path: ${storagePath}`);
        return storagePath;
      }
    }

    // 3. Try `which trowel` on the system PATH
    const whichPath = await this.whichTrowel();
    if (whichPath) {
      logger.info(`Trowel CLI found on PATH: ${whichPath}`);
      return whichPath;
    }

    // 4. Check ~/.orchard/bin/trowel
    const defaultPath = path.join(os.homedir(), '.orchard', 'bin', 'trowel');
    if (fs.existsSync(defaultPath)) {
      logger.info(`Trowel CLI found at default path: ${defaultPath}`);
      return defaultPath;
    }

    logger.info('Trowel CLI not found');
    return undefined;
  }

  /**
   * Runs `{trowelPath} --version` and parses the semver version string.
   * Returns the version (e.g. "0.3.0") or undefined if unavailable.
   */
  async getLocalVersion(trowelPath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      cp.execFile(trowelPath, ['--version'], { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(undefined);
          return;
        }
        // Match semver pattern: X.Y.Z (optional pre-release/build metadata)
        const match = stdout.trim().match(/(\d+\.\d+\.\d+(?:[-+].+)?)/);
        resolve(match ? match[1] : undefined);
      });
    });
  }

  /**
   * Checks for the Trowel CLI and shows an informational message if it is not installed.
   */
  async promptInstallIfMissing(): Promise<void> {
    const trowelPath = await this.detectTrowel();
    if (trowelPath) {
      return;
    }

    const action = await vscode.window.showInformationMessage(
      'Trowel CLI not found. Some features may be limited.',
      'Learn More',
    );

    if (action === 'Learn More') {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/orchard-cde/orchard'));
    }
  }

  private whichTrowel(): Promise<string | undefined> {
    const command = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      cp.execFile(command, ['trowel'], { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(undefined);
        } else {
          resolve(stdout.trim().split('\n')[0]);
        }
      });
    });
  }
}
