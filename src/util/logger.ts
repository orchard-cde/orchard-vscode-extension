import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let outputChannel: vscode.OutputChannel | undefined;
let currentLevel: LogLevel = 'info';

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Orchard');
  }
  return outputChannel;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function debug(msg: string): void {
  if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.debug) {
    getChannel().appendLine(`[${timestamp()}] [DEBUG] ${msg}`);
  }
}

export function info(msg: string): void {
  if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.info) {
    getChannel().appendLine(`[${timestamp()}] [INFO] ${msg}`);
  }
}

export function warn(msg: string): void {
  if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.warn) {
    getChannel().appendLine(`[${timestamp()}] [WARN] ${msg}`);
  }
}

export function error(msg: string): void {
  if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.error) {
    getChannel().appendLine(`[${timestamp()}] [ERROR] ${msg}`);
  }
}

export function show(): void {
  getChannel().show();
}
