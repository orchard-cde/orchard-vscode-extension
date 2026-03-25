import * as vscode from 'vscode';

/**
 * Create the Orchard status bar item.
 * Shows the connected grove name when inside a remote SSH session.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  return vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
}

/**
 * Update the status bar item visibility and text based on the current
 * remote connection.
 *
 * When connected via SSH Remote to an Orchard grove (host name starts
 * with "orchard-"), the status bar shows the grove name. Otherwise it
 * is hidden.
 */
export function updateStatusBar(statusBar: vscode.StatusBarItem): void {
  if (vscode.env.remoteName === 'ssh-remote') {
    // The remote authority is available as a property on the env namespace
    // but is not part of the stable API typings. We access it dynamically.
    // It looks like "ssh-remote+orchard-<grove-name>".
    const env = vscode.env as unknown as Record<string, unknown>;
    const authority = (env['remoteAuthority'] as string) ?? '';
    const match = authority.match(/ssh-remote\+orchard-(.+)/);

    if (match) {
      const groveName = match[1];
      statusBar.text = `$(plug) Grove: ${groveName}`;
      statusBar.show();
      return;
    }
  }

  statusBar.hide();
}
