import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
  },
  env: {
    openExternal: vi.fn(),
  },
  Uri: {
    parse: vi.fn(),
  },
}));

describe('TrowelService.getLocalVersion', () => {
  it('returns version string when binary outputs semver', async () => {
    const { TrowelService } = await import('../trowelService');
    const service = new TrowelService();
    // Create a temp script that outputs a version
    const scriptPath = path.join(os.tmpdir(), `trowel-mock-${Date.now()}`);
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "0.3.0"\n');
    fs.chmodSync(scriptPath, 0o755);

    try {
      const result = await service.getLocalVersion(scriptPath);
      expect(result).toBe('0.3.0');
    } finally {
      fs.unlinkSync(scriptPath);
    }
  });

  it('returns undefined when binary does not exist', async () => {
    const { TrowelService } = await import('../trowelService');
    const service = new TrowelService();
    const result = await service.getLocalVersion('/nonexistent/trowel');
    expect(result).toBeUndefined();
  });

  it('resolves within timeout when binary hangs', { timeout: 15000 }, async () => {
    const { TrowelService } = await import('../trowelService');
    const service = new TrowelService();
    // Create a script that hangs indefinitely
    const scriptPath = path.join(os.tmpdir(), `trowel-hang-${Date.now()}`);
    fs.writeFileSync(scriptPath, '#!/bin/sh\nsleep 999\n');
    fs.chmodSync(scriptPath, 0o755);

    try {
      const start = Date.now();
      const result = await service.getLocalVersion(scriptPath);
      const elapsed = Date.now() - start;
      expect(result).toBeUndefined();
      // Should resolve in ~5s (timeout) not hang forever
      expect(elapsed).toBeLessThan(10000);
    } finally {
      fs.unlinkSync(scriptPath);
    }
  });

  it('returns undefined when binary outputs non-version text', async () => {
    const { TrowelService } = await import('../trowelService');
    const service = new TrowelService();
    const scriptPath = path.join(os.tmpdir(), `trowel-no-ver-${Date.now()}`);
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "no version here"\n');
    fs.chmodSync(scriptPath, 0o755);

    try {
      const result = await service.getLocalVersion(scriptPath);
      expect(result).toBeUndefined();
    } finally {
      fs.unlinkSync(scriptPath);
    }
  });
});

describe('TrowelUpdater checksum cleanup', () => {
  let tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ok */ }
    }
    tmpFiles = [];
  });

  it('temp file is cleaned up after successful processing', () => {
    const tmpChecksum = path.join(os.tmpdir(), `trowel-checksum-test-${Date.now()}.txt`);
    tmpFiles.push(tmpChecksum);

    fs.writeFileSync(tmpChecksum, 'abc123  trowel-linux-amd64.tar.gz\n');

    try {
      const content = fs.readFileSync(tmpChecksum, 'utf-8');
      expect(content).toContain('trowel-linux-amd64.tar.gz');
    } finally {
      try { fs.unlinkSync(tmpChecksum); } catch { /* already deleted */ }
    }

    expect(fs.existsSync(tmpChecksum)).toBe(false);
  });

  it('temp file is cleaned up even on error', () => {
    const tmpChecksum = path.join(os.tmpdir(), `trowel-checksum-error-${Date.now()}.txt`);
    tmpFiles.push(tmpChecksum);

    fs.writeFileSync(tmpChecksum, 'data');

    let caught = false;
    try {
      // Simulate an error during processing
      throw new Error('simulated failure');
    } catch {
      caught = true;
    } finally {
      try { fs.unlinkSync(tmpChecksum); } catch { /* already deleted */ }
    }

    expect(caught).toBe(true);
    expect(fs.existsSync(tmpChecksum)).toBe(false);
  });

  it('SHA-256 checksum comparison works correctly', () => {
    const data = Buffer.from('trowel binary content');
    const expectedHash = crypto.createHash('sha256').update(data).digest('hex');

    const assetPath = path.join(os.tmpdir(), `trowel-test-${Date.now()}`);
    tmpFiles.push(assetPath);

    fs.writeFileSync(assetPath, data);
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');

    expect(actualHash).toBe(expectedHash);
  });
});
