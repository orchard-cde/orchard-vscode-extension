import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  sanitizeHostName,
  wslPathToWin,
  filterSshConfigLines,
  buildSshConfig,
  writeSshConfig,
} from '../connectGroveUtils';

describe('sanitizeHostName', () => {
  it('prepends orchard- prefix', () => {
    expect(sanitizeHostName('main')).toBe('orchard-main');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeHostName('my grove')).toBe('orchard-my-grove');
  });

  it('replaces underscores with hyphens', () => {
    expect(sanitizeHostName('my_grove')).toBe('orchard-my-grove');
  });

  it('preserves existing hyphens', () => {
    expect(sanitizeHostName('my-grove')).toBe('orchard-my-grove');
  });

  it('preserves alphanumeric characters', () => {
    expect(sanitizeHostName('grove123')).toBe('orchard-grove123');
  });

  it('replaces dots with hyphens', () => {
    expect(sanitizeHostName('grove.v2')).toBe('orchard-grove-v2');
  });

  it('handles empty string', () => {
    expect(sanitizeHostName('')).toBe('orchard-');
  });

  it('handles multiple special characters', () => {
    expect(sanitizeHostName('my crazy grove!')).toBe('orchard-my-crazy-grove-');
  });
});

describe('wslPathToWin', () => {
  it('converts /mnt/c/Users/X to C:\\Users\\X', () => {
    expect(wslPathToWin('/mnt/c/Users/Steven')).toBe('C:\\Users\\Steven');
  });

  it('converts /mnt/c/Users/X/.ssh to C:\\Users\\X\\.ssh', () => {
    expect(wslPathToWin('/mnt/c/Users/Steven Tompkins/.ssh')).toBe('C:\\Users\\Steven Tompkins\\.ssh');
  });

  it('uppercases the drive letter', () => {
    expect(wslPathToWin('/mnt/d/data')).toBe('D:\\data');
  });

  it('handles /mnt/e/ path', () => {
    expect(wslPathToWin('/mnt/e/tools/bin')).toBe('E:\\tools\\bin');
  });
});

describe('filterSshConfigLines', () => {
  const apiConfig = `Host orchard-flourishing-grove
  HostName 10.0.0.12
  User cultivator
  Port 22
  IdentityFile ~/.ssh/orchard_ed25519`;

  it('removes Host line', () => {
    const result = filterSshConfigLines(apiConfig);
    expect(result.some((l) => l.trim().startsWith('Host '))).toBe(false);
  });

  it('removes IdentityFile line', () => {
    const result = filterSshConfigLines(apiConfig);
    expect(result.some((l) => l.trim().startsWith('IdentityFile'))).toBe(false);
  });

  it('preserves HostName, User, Port', () => {
    const result = filterSshConfigLines(apiConfig);
    const joined = result.join('\n');
    expect(joined).toContain('HostName 10.0.0.12');
    expect(joined).toContain('User cultivator');
    expect(joined).toContain('Port 22');
  });

  it('preserves comment lines', () => {
    const config = `# Orchard Grove: orchard-main
Host orchard-orchard-main
  HostName 127.0.0.1
  IdentityFile /opt/orchard/.ssh/orchard_ed25519`;
    const result = filterSshConfigLines(config);
    expect(result[0].trim()).toBe('# Orchard Grove: orchard-main');
  });

  it('preserves non-IdentityFile indented lines', () => {
    const config = `Host test
  HostName 127.0.0.1
  IdentityFile /path/to/key
  StrictHostKeyChecking no`;
    const result = filterSshConfigLines(config);
    const joined = result.join('\n');
    expect(joined).toContain('StrictHostKeyChecking no');
    expect(joined).not.toContain('IdentityFile');
  });

  it('handles config with no Host or IdentityFile', () => {
    const config = `  HostName 10.0.0.1
  User cultivator`;
    const result = filterSshConfigLines(config);
    expect(result).toHaveLength(2);
  });

  it('handles empty config', () => {
    const result = filterSshConfigLines('');
    expect(result).toEqual(['']);
  });

  it('does not remove lines starting with IdentityFile at word boundary', () => {
    const config = `Host test
  HostName 127.0.0.1
  IdentityFileAgent stuff`;
    const result = filterSshConfigLines(config);
    expect(result.some((l) => l.includes('IdentityFileAgent'))).toBe(true);
  });
});

describe('buildSshConfig', () => {
  it('produces Host line + filtered lines + IdentityFile', () => {
    const filtered = ['  HostName 127.0.0.1', '  User cultivator'];
    const result = buildSshConfig('orchard-my-grove', filtered, '/home/user/.ssh/orchard_ed25519');
    expect(result).toBe(
      'Host orchard-my-grove\n  HostName 127.0.0.1\n  User cultivator\n  IdentityFile /home/user/.ssh/orchard_ed25519',
    );
  });

  it('uses the provided hostname, not the API one', () => {
    const result = buildSshConfig('orchard-orchard-main', [], '/key');
    expect(result).toMatch(/^Host orchard-orchard-main/);
  });

  it('handles Windows IdentityFile path', () => {
    const result = buildSshConfig('host', [], '"C:\\Users\\X\\.ssh\\orchard_ed25519"');
    expect(result).toContain('IdentityFile "C:\\Users\\X\\.ssh\\orchard_ed25519"');
  });
});

describe('writeSshConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'orchard-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates orchard_hosts/ directory and writes host config file', async () => {
    await writeSshConfig(tmpDir, 'orchard-test', 'Host orchard-test\n  HostName 127.0.0.1', 'Include orchard_hosts/*');

    const hostConfig = await fs.promises.readFile(path.join(tmpDir, 'orchard_hosts', 'orchard-test'), 'utf-8');
    expect(hostConfig).toBe('Host orchard-test\n  HostName 127.0.0.1');
  });

  it('creates Include directive in main config when none exists', async () => {
    await writeSshConfig(tmpDir, 'orchard-test', 'config', 'Include orchard_hosts/*');

    const mainConfig = await fs.promises.readFile(path.join(tmpDir, 'config'), 'utf-8');
    expect(mainConfig).toMatch(/^Include orchard_hosts\//);
  });

  it('prepends Include directive to existing config', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'config'), 'Host existing\n  HostName 1.2.3.4');

    await writeSshConfig(tmpDir, 'orchard-test', 'config', 'Include orchard_hosts/*');

    const mainConfig = await fs.promises.readFile(path.join(tmpDir, 'config'), 'utf-8');
    expect(mainConfig).toContain('Include orchard_hosts/*');
    expect(mainConfig).toContain('Host existing');
    // Include should be before existing content
    expect(mainConfig.indexOf('Include')).toBeLessThan(mainConfig.indexOf('Host existing'));
  });

  it('does not duplicate Include directive if already present', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'config'), 'Include orchard_hosts/*\n\nHost existing');

    await writeSshConfig(tmpDir, 'orchard-test', 'config', 'Include orchard_hosts/*');

    const mainConfig = await fs.promises.readFile(path.join(tmpDir, 'config'), 'utf-8');
    const matches = mainConfig.match(/Include orchard_hosts/g);
    expect(matches).toHaveLength(1);
  });

  it('writes multiple host configs without interfering', async () => {
    await writeSshConfig(tmpDir, 'host-a', 'Host host-a', 'Include orchard_hosts/*');
    await writeSshConfig(tmpDir, 'host-b', 'Host host-b', 'Include orchard_hosts/*');

    const configA = await fs.promises.readFile(path.join(tmpDir, 'orchard_hosts', 'host-a'), 'utf-8');
    const configB = await fs.promises.readFile(path.join(tmpDir, 'orchard_hosts', 'host-b'), 'utf-8');
    expect(configA).toBe('Host host-a');
    expect(configB).toBe('Host host-b');

    // Include should appear only once in main config
    const mainConfig = await fs.promises.readFile(path.join(tmpDir, 'config'), 'utf-8');
    const matches = mainConfig.match(/Include orchard_hosts/g);
    expect(matches).toHaveLength(1);
  });

  it('overwrites existing host config file', async () => {
    await writeSshConfig(tmpDir, 'orchard-test', 'old content', 'Include orchard_hosts/*');
    await writeSshConfig(tmpDir, 'orchard-test', 'new content', 'Include orchard_hosts/*');

    const hostConfig = await fs.promises.readFile(path.join(tmpDir, 'orchard_hosts', 'orchard-test'), 'utf-8');
    expect(hostConfig).toBe('new content');
  });
});
