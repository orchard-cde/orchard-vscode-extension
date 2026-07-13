import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { getTrowelAutoUpdate, getTrowelPath } from '../util/configuration';
import { TrowelService } from './trowelService';
import * as logger from '../util/logger';

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export class TrowelUpdater {
  constructor(
    private context: vscode.ExtensionContext,
    private trowelService: TrowelService,
  ) {}

  /**
   * Checks for a newer Trowel CLI release and installs it if available.
   * Non-blocking, fails silently with logging.
   */
  async ensureLatestTrowel(): Promise<void> {
    if (!getTrowelAutoUpdate()) {
      logger.info('Trowel auto-update disabled by setting');
      return;
    }

    // If user has a custom path, don't overwrite
    if (getTrowelPath()) {
      logger.info('Trowel auto-update skipped: custom trowelPath configured');
      return;
    }

    try {
      // Get current version (if any)
      const currentPath = await this.trowelService.detectTrowel();
      const localVersion = currentPath
        ? await this.trowelService.getLocalVersion(currentPath)
        : undefined;

      // Fetch latest release info
      const release = await this.fetchLatestRelease();
      if (!release) {
        return;
      }

      // Compare versions
      if (localVersion && this.compareVersions(localVersion, release.version) >= 0) {
        logger.info(`Trowel is up to date (${localVersion})`);
        return;
      }

      // Download, verify, install
      const installDir = path.join(this.context.globalStoragePath, 'bin');
      const downloaded = await this.downloadAsset(release.downloadUrl, installDir, release.assetName);
      if (!downloaded) {
        return;
      }

      // Verify checksum
      const verified = await this.verifyChecksum(downloaded, release.checksumUrl, release.assetName);
      if (!verified) {
        logger.warn('Trowel checksum verification failed, skipping update');
        fs.unlinkSync(downloaded);
        return;
      }

      // Extract and install
      const installedPath = await this.extractAndInstall(downloaded, installDir);
      fs.unlinkSync(downloaded);

      if (installedPath) {
        // Make executable
        fs.chmodSync(installedPath, 0o755);
        logger.info(`Trowel updated to ${release.version}`);
        vscode.window.showInformationMessage(`Trowel updated to ${release.version}`);
      }
    } catch (err) {
      logger.warn(`Trowel auto-update failed: ${err}`);
    }
  }

  private async fetchLatestRelease(): Promise<{
    version: string;
    assetName: string;
    downloadUrl: string;
    checksumUrl: string;
  } | undefined> {
    const platformArch = this.getPlatformArch();
    if (!platformArch) {
      logger.info(`No Trowel binary available for ${process.platform}-${process.arch}`);
      return undefined;
    }

    const { platform, arch } = platformArch;
    const assetName = `trowel-${platform}-${arch}.tar.gz`;

    try {
      const release = await this.httpGet<GitHubRelease>(
        'https://api.github.com/repos/orchard-cde/orchard/releases/latest',
      );

      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) {
        logger.info(`No asset "${assetName}" in release ${release.tag_name}`);
        return undefined;
      }

      const checksumAsset = release.assets.find((a) => a.name === 'checksums-sha256.txt');
      if (!checksumAsset) {
        logger.warn('No checksums-sha256.txt in release, skipping update for safety');
        return undefined;
      }

      return {
        version: release.tag_name.replace(/^v/, ''),
        assetName,
        downloadUrl: asset.browser_download_url,
        checksumUrl: checksumAsset.browser_download_url,
      };
    } catch (err) {
      logger.warn(`Failed to fetch Trowel release info: ${err}`);
      return undefined;
    }
  }

  private getPlatformArch(): { platform: string; arch: string } | undefined {
    const platformMap: Record<string, string> = {
      linux: 'linux',
      darwin: 'macos',
      win32: 'windows',
    };
    const archMap: Record<string, string> = {
      x64: 'amd64',
      arm64: 'arm64',
    };

    const platform = platformMap[process.platform];
    const arch = archMap[process.arch];

    if (!platform || !arch) {
      return undefined;
    }

    return { platform, arch };
  }

  private async downloadAsset(url: string, destDir: string, fileName: string): Promise<string | undefined> {
    try {
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);
      await this.httpDownload(url, destPath);
      return destPath;
    } catch (err) {
      logger.warn(`Failed to download Trowel asset: ${err}`);
      return undefined;
    }
  }

  private async verifyChecksum(
    assetPath: string,
    checksumUrl: string,
    assetName: string,
  ): Promise<boolean> {
    try {
      const tmpChecksum = path.join(os.tmpdir(), `trowel-checksum-${Date.now()}.txt`);
      await this.httpDownload(checksumUrl, tmpChecksum);

      const checksumContent = fs.readFileSync(tmpChecksum, 'utf-8');
      fs.unlinkSync(tmpChecksum);

      // Parse checksum file (format: "hash  filename")
      const lines = checksumContent.split('\n');
      const expectedLine = lines.find((l) => l.includes(assetName));
      if (!expectedLine) {
        logger.warn(`No checksum found for ${assetName}`);
        return false;
      }

      const expectedHash = expectedLine.split(/\s+/)[0];

      // Compute actual hash
      const fileBuffer = fs.readFileSync(assetPath);
      const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      return actualHash === expectedHash;
    } catch (err) {
      logger.warn(`Checksum verification failed: ${err}`);
      return false;
    }
  }

  private async extractAndInstall(tarballPath: string, installDir: string): Promise<string | undefined> {
    const tmpExtract = path.join(os.tmpdir(), `trowel-extract-${Date.now()}`);
    try {
      fs.mkdirSync(tmpExtract, { recursive: true });

      // Extract tarball
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['xzf', tarballPath, '-C', tmpExtract], (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Find the trowel binary in extracted contents (trowel on unix, trowel.exe on Windows)
      const binaryName = process.platform === 'win32' ? 'trowel.exe' : 'trowel';
      const trowelBinary = this.findBinary(tmpExtract, binaryName);
      if (!trowelBinary) {
        logger.warn('Could not find trowel binary in extracted archive');
        return undefined;
      }

      // Install to globalStorage — write to temp path then rename for atomic replacement
      fs.mkdirSync(installDir, { recursive: true });
      const installPath = path.join(installDir, binaryName);
      const tmpInstall = installPath + `.tmp-${Date.now()}`;
      fs.copyFileSync(trowelBinary, tmpInstall);
      fs.renameSync(tmpInstall, installPath);

      return installPath;
    } catch (err) {
      logger.warn(`Failed to extract Trowel: ${err}`);
      return undefined;
    } finally {
      // Clean up temp extract directory
      this.removeDirSync(tmpExtract);
    }
  }

  private findBinary(dir: string, name: string): string | undefined {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === name && entry.isFile()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = this.findBinary(fullPath, name);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  private removeDirSync(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup
    }
  }

  /**
   * Compares two semver version strings by major.minor.patch only.
   * Pre-release and build metadata (e.g. "1.2.3-beta.1") are ignored for comparison —
   * "1.2.3-beta.1" is treated as equal to "1.2.3". This is intentional: Trowel releases
   * use clean semver tags without pre-release suffixes.
   */
  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => {
      const parts = v.split(/[.-]/).map(Number);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    };
    const va = parse(a);
    const vb = parse(b);

    if (va.major !== vb.major) return va.major - vb.major;
    if (va.minor !== vb.minor) return va.minor - vb.minor;
    return va.patch - vb.patch;
  }

  private async httpGet<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'orchard-vscode-extension' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private async httpDownload(url: string, destPath: string): Promise<void> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'orchard-vscode-extension' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
  }
}
