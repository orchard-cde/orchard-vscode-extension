import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getTrowelPath } from '../util/configuration';
import * as logger from '../util/logger';

export class TrowelService {
  /**
   * Finds the Trowel CLI binary by checking:
   * 1. The orchard.trowelPath setting
   * 2. The system PATH via `which trowel`
   * 3. ~/.orchard/bin/trowel
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

    // 2. Try `which trowel` on the system PATH
    const whichPath = await this.whichTrowel();
    if (whichPath) {
      logger.info(`Trowel CLI found on PATH: ${whichPath}`);
      return whichPath;
    }

    // 3. Check ~/.orchard/bin/trowel
    const defaultPath = path.join(os.homedir(), '.orchard', 'bin', 'trowel');
    if (fs.existsSync(defaultPath)) {
      logger.info(`Trowel CLI found at default path: ${defaultPath}`);
      return defaultPath;
    }

    logger.info('Trowel CLI not found');
    return undefined;
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
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/orchard-cde/trowel'));
    }
  }

  private whichTrowel(): Promise<string | undefined> {
    const command = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      cp.execFile(command, ['trowel'], (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(undefined);
        } else {
          resolve(stdout.trim().split('\n')[0]);
        }
      });
    });
  }
}
