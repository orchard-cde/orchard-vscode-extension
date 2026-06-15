# Orchard for VS Code

Manage Orchard Cloud Development Environments from VS Code.

## Features

- **Grove lifecycle management** -- create, connect, stop, start, and delete groves
- **Real-time status updates** via Server-Sent Events (SSE)
- **SSH Remote connection** to flourishing groves through the Remote - SSH extension
- **Activity Bar sidebar** with a dedicated grove explorer for at-a-glance status

## Requirements

- VS Code 1.85 or later
- [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) extension
- Access to an Orchard Trellis server

## Getting Started

1. Install the extension.
2. Open Settings and set **Orchard: Server Url** (`orchard.serverUrl`) to your Trellis server address.
3. Optionally set **Orchard: Cultivator Id** (`orchard.cultivatorId`) if your server requires it.
4. Open the Orchard sidebar from the Activity Bar to view and manage your groves.

## Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `orchard.serverUrl` | `string` | `""` | Orchard Trellis server URL (e.g., `https://orchard.example.com`) |
| `orchard.cultivatorId` | `string` | `""` | Cultivator UUID for authentication |
| `orchard.trowelPath` | `string` | `""` | Path to Trowel CLI binary (auto-detected if empty) |
| `orchard.autoRefreshInterval` | `number` | `30` | Seconds between grove list auto-refresh |
| `orchard.sseEnabled` | `boolean` | `true` | Enable Server-Sent Events for real-time grove status updates |

## Commands

| Command | Description |
|---|---|
| Orchard: Create Grove | Create a new grove |
| Connect to Grove | Open an SSH Remote session to a flourishing grove |
| Start Grove | Start a dormant grove |
| Stop Grove | Stop a flourishing grove |
| Delete Grove | Delete a grove |
| Refresh Groves | Manually refresh the grove list |
| Copy Grove ID | Copy a grove's ID to the clipboard |
| Show Grove Details | View detailed grove information |

## License

Orchard for VS Code is licensed under the [Apache License, Version 2.0](LICENSE). See the [NOTICE](NOTICE) file for attribution.
