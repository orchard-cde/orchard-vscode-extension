import * as vscode from 'vscode';
import { GroveResponse, GroveState } from '../api/types';
import { CMD_GROVE_SHOW_DETAILS } from '../constants';

/**
 * Extracts a short repository name from a full URL.
 * e.g., "https://github.com/org/repo" -> "org/repo"
 */
function shortRepoName(repositoryUrl: string): string {
  try {
    const url = new URL(repositoryUrl);
    // Remove leading slash and trailing .git
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '');
  } catch {
    return repositoryUrl;
  }
}

function getIconForState(state: GroveState): vscode.ThemeIcon {
  switch (state) {
    case 'PREPARING':
    case 'PLANTING':
    case 'GROWING':
      return new vscode.ThemeIcon('loading~spin');
    case 'FLOURISHING':
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
    case 'DORMANT':
      return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('disabledForeground'));
    case 'BLIGHTED':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    case 'CLEARING':
      return new vscode.ThemeIcon('loading~spin');
    case 'CLEARED':
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
  }
}

function buildTooltip(grove: GroveResponse): vscode.MarkdownString {
  const lines: string[] = [];
  lines.push(`**${grove.name}**`);
  lines.push('');
  lines.push(`**Repository:** ${grove.repositoryUrl}`);
  lines.push(`**Branch:** ${grove.branch}`);
  lines.push(`**State:** ${grove.state}`);

  if (grove.seedling) {
    lines.push('');
    lines.push(`**Machine:** ${grove.seedling.cpuCores} CPU / ${grove.seedling.memoryMb} MB RAM / ${grove.seedling.diskGb} GB Disk`);
    if (grove.seedling.ipAddress) {
      lines.push(`**IP:** ${grove.seedling.ipAddress}`);
    }
  }

  lines.push('');
  lines.push(`**Planted at:** ${grove.plantedAt}`);

  const md = new vscode.MarkdownString(lines.join('\n'));
  md.supportThemeIcons = true;
  return md;
}

export class GroveTreeItem extends vscode.TreeItem {
  constructor(public readonly grove: GroveResponse) {
    super(grove.name, vscode.TreeItemCollapsibleState.None);

    this.description = `${shortRepoName(grove.repositoryUrl)} (${grove.branch})`;
    this.contextValue = `grove-${grove.state.toLowerCase()}`;
    this.iconPath = getIconForState(grove.state);
    this.tooltip = buildTooltip(grove);
    this.command = {
      command: CMD_GROVE_SHOW_DETAILS,
      title: 'Show Grove Details',
      arguments: [this],
    };
  }
}
