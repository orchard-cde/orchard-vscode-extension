import * as vscode from 'vscode';
import {
  CONFIG_SERVER_URL,
  CONFIG_CULTIVATOR_ID,
  CONFIG_TROWEL_PATH,
  CONFIG_AUTO_REFRESH_INTERVAL,
  CONFIG_SSE_ENABLED,
  CONFIG_TROWEL_AUTO_UPDATE,
} from '../constants';

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('orchard');
}

function stripPrefix(key: string): string {
  return key.replace('orchard.', '');
}

export function getServerUrl(): string {
  return getConfig().get<string>(stripPrefix(CONFIG_SERVER_URL), '');
}

export function getCultivatorId(): string {
  return getConfig().get<string>(stripPrefix(CONFIG_CULTIVATOR_ID), '');
}

export function getTrowelPath(): string {
  return getConfig().get<string>(stripPrefix(CONFIG_TROWEL_PATH), '');
}

export function getAutoRefreshInterval(): number {
  return getConfig().get<number>(stripPrefix(CONFIG_AUTO_REFRESH_INTERVAL), 30);
}

export function getSseEnabled(): boolean {
  return getConfig().get<boolean>(stripPrefix(CONFIG_SSE_ENABLED), true);
}

export function getTrowelAutoUpdate(): boolean {
  return getConfig().get<boolean>(stripPrefix(CONFIG_TROWEL_AUTO_UPDATE), true);
}
