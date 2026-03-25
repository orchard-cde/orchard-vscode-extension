import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Orchard');
  }
  return outputChannel;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function info(msg: string): void {
  getChannel().appendLine(`[${timestamp()}] [INFO] ${msg}`);
}

export function warn(msg: string): void {
  getChannel().appendLine(`[${timestamp()}] [WARN] ${msg}`);
}

export function error(msg: string): void {
  getChannel().appendLine(`[${timestamp()}] [ERROR] ${msg}`);
}

export function show(): void {
  getChannel().show();
}
