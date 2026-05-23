# Orchard VS Code Extension — Webview Dashboard Design

**Date:** 2026-05-22
**Project:** orchard-vscode-extension — VS Code extension for managing Orchard CDE groves

---

## Overview

Add a rich webview-based dashboard to the Orchard VS Code extension, replicating the core functionality of the Canopy web UI. The webview replaces the current simple tree view and info-message details with a full React-based dashboard that shows grove cards, detailed grove info, and real-time state updates.

---

## Architecture

```
┌──────────────────────────────────────────┐
│  VS Code Extension Host                   │
│                                           │
│  ┌────────────────────────────────────┐  │
│  │  extension.ts                       │  │
│  │  (activation, command registration) │  │
│  └──────────┬─────────────────────────┘  │
│             │                             │
│  ┌──────────▼─────────────────────────┐  │
│  │  OrchardWebviewProvider             │  │
│  │  (src/views/orchardWebview.ts)      │  │
│  │                                     │  │
│  │  - create/register webview panel    │  │
│  │  - handle postMessage requests      │  │
│  │  - call TrellisClient/GroveManager  │  │
│  │  - forward SSE events to webview    │  │
│  └──────────┬─────────────────────────┘  │
│             │ postMessage                  │
│  ┌──────────▼─────────────────────────┐  │
│  │  Webview Panel                     │  │
│  │  (dist/webview/index.html)         │  │
│  │                                     │  │
│  │  React SPA bundled separately      │  │
│  │  by webpack (multi-entry)          │  │
│  │                                     │  │
│  │  Views:                             │  │
│  │  ├─ Dashboard (grove list)         │  │
│  │  ├─ Grove Detail                   │  │
│  │  └─ Create Grove (modal/form)     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Services:                                 │
│  ├─ TrellisClient            ──► Trellis  │
│  ├─ GroveManager (cache + polling)         │
│  ├─ SseManager (real-time events)          │
│  └─ HeaderAuthProvider                     │
└──────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Webview framework | React (standalone, bundled) | Familiar component model, matches Canopy patterns, easy state management |
| Bundling | Separate webpack entry + HtmlWebpackPlugin | Webview entry builds JS bundle; HtmlWebpackPlugin generates `dist/webview/index.html` referencing the bundle |
| API access | postMessage bridge | Webview never calls Trellis directly — all API calls go through the extension host which has auth/session context |
| Real-time updates | Via extension bridge | SSE connections managed by SseManager in extension host; events forwarded to webview via postMessage |
| Styling | CSS (no MUI dependency) | Avoids shipping MUI in the extension bundle; webview CSS can match VS Code theme variables |
| State | React useState/useEffect per view | Simple enough that no global store is needed |

---

## Component Tree

```
OrchardWebview
├── App
│   ├── Header
│   │   ├── Logo + "Orchard" title
│   │   ├── Refresh button
│   │   └── Plant Grove button
│   │
│   ├── DashboardView (route: #/)
│   │   ├── LoadingSpinner
│   │   ├── ErrorAlert
│   │   ├── EmptyState
│   │   └── GroveCardGrid
│   │       └── GroveCard (per grove)
│   │           ├── Name + StatusChip
│   │           ├── Repo + Branch
│   │           ├── Last Accessed
│   │           └── Actions (Open, Delete)
│   │
│   └── GroveDetailView (route: #/grove/:id)
│       ├── Header (name + status)
│       ├── GroveStateStepper
│       │   ├── Preparing (0)
│       │   ├── Planting (1)
│       │   ├── Growing (2)
│       │   └── Flourishing (3)
│       ├── RepositoryInfo
│       ├── ResourcesSection (CPU, RAM, Disk chips)
│       ├── SshConfigBlock (with Copy button)
│       └── ActionButtons (Stop/Start/Delete)
│
├── PlantGroveModal
│   ├── Repository URL input
│   ├── Branch input
│   ├── Grove Name input
│   └── Machine Size selector
│
└── ConfirmDeleteDialog
```

---

## Views & Routes

The webview uses hash-based routing (`#/`, `#/grove/:id`). No external router library — a lightweight `useEffect` on `window.hashchange` is sufficient.

### Dashboard View (`#/`)

- **Purpose:** List all groves for the current cultivator, with status and quick actions
- **Load:** Sends `listGroves` message on mount; listens for `groveStateChanged` SSE events for live updates
- **States:** Loading, Error, Empty, Populated
- **Actions:** Click "Open" → navigate to `#/grove/:id`; Click "Delete" → show confirm dialog; Click "Plant Grove" → show modal
- **Real-time:** SSE events auto-update status chips and card ordering

### Grove Detail View (`#/grove/:id`)

- **Purpose:** Deep view of a single grove with lifecycle stepper, resources, and SSH config
- **Load:** Sends `getGrove(id)` on mount; subscribes to SSE for that grove
- **Back navigation:** Header "← Back to Groves" button
- **State stepper:** 4-step MUI-style Stepper; BLIGHTED shown with error overlay
- **SSH config:** Pre-formatted block, copy button using `navigator.clipboard.writeText()`

### Create Grove (Modal)

- **Purpose:** Wizard-style form to plant a new grove
- **Fields:** Repository URL (required), Branch (default "main"), Name (optional, auto-suggested), Machine Size (Small/Medium/Large QuickPick)
- **After success:** Navigate to the new grove detail view

---

## postMessage Protocol

All webview ↔ extension communication uses VS Code's `postMessage`/`onDidReceiveMessage` API.

### Webview → Extension (Requests)

| Message | Payload | Handler |
|---------|---------|---------|
| `listGroves` | `{}` | Calls `groveManager.getGroves()` → returns `GroveResponse[]` |
| `getGrove` | `{ id: string }` | Calls `trellisClient.getGrove(id)` → returns `GroveResponse` |
| `createGrove` | `{ repositoryUrl, branch?, name?, machineSize? }` | Calls `groveManager.createGrove(...)` → returns `GroveResponse` |
| `deleteGrove` | `{ id: string }` | Calls `groveManager.deleteGrove(id)` → `void` |
| `stopGrove` | `{ id: string }` | Calls `groveManager.stopGrove(id)` → `GroveResponse` |
| `startGrove` | `{ id: string }` | Calls `groveManager.startGrove(id)` → `GroveResponse` |
| `getSshConfig` | `{ id: string }` | Calls `trellisClient.getSshConfig(id)` → `string` |

### Extension → Webview (Events)

| Message | Payload | Trigger |
|---------|---------|---------|
| `groveListChanged` | `{ groves: GroveResponse[] }` | After any create/delete/refresh, or polling tick |
| `groveStateChanged` | `{ groveId, previousState, newState }` | SSE event from SseManager |
| `groveUpdated` | `{ grove: GroveResponse }` | After individual grove mutation (stop/start) |

### Response Format

```typescript
interface WebviewResponse {
  type: string;       // mirrors the request type
  success: boolean;
  data?: unknown;
  error?: string;
}
```

---

## Implementation Plan

### Phase 1: Scaffold

1. Add webpack multi-entry config — `./src/webview/index.tsx` → `dist/webview/`
2. Create `src/views/orchardWebviewProvider.ts` — register webview panel, handle messaging
3. Wire into `extension.ts` — add a new command `orchard.showDashboard` that opens the panel
4. Create `src/webview/` directory with React entry point and App component

### Phase 2: Dashboard View

5. Build `GroveCardGrid`, `GroveCard`, `StatusChip` components
6. Build loading/error/empty states
7. Implement `listGroves` message handler in provider
8. Wire SSE forwarding for live status updates

### Phase 3: Grove Detail View

9. Build `GroveStateStepper` component
10. Build `ResourcesSection`, `SshConfigBlock` components
11. Implement deep navigation (hash routing)
12. Wire stop/start/delete actions

### Phase 4: Create Grove

13. Build `PlantGroveModal` with form fields
14. Wire create handler and success navigation

### Phase 5: Polish

15. VS Code theme-aware styling (use `body.vscode-dark`/`body.vscode-light` CSS classes)
16. Keyboard navigation and accessibility
17. Error handling and retry states

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/views/orchardWebviewProvider.ts` | **New** | Webview panel provider with postMessage bridge |
| `src/webview/` | **New dir** | React SPA source (entry, components, styles) |
| `src/webview/index.tsx` | **New** | React entry point |
| `src/webview/App.tsx` | **New** | Root component with hash router |
| `src/webview/components/DashboardView.tsx` | **New** | Grove list dashboard |
| `src/webview/components/GroveCard.tsx` | **New** | Individual grove card |
| `src/webview/components/GroveDetailView.tsx` | **New** | Grove detail with stepper, etc. |
| `src/webview/components/GroveStateStepper.tsx` | **New** | 4-step lifecycle stepper |
| `src/webview/components/PlantGroveModal.tsx` | **New** | Create grove form modal |
| `src/webview/components/SshConfigBlock.tsx` | **New** | SSH config with copy button |
| `src/webview/components/StatusChip.tsx` | **New** | Color-coded state chip |
| `src/webview/styles.css` | **New** | All webview styles |
| `src/extension.ts` | **Edit** | Add `orchard.showDashboard` command, register webview provider |
| `src/constants.ts` | **Edit** | Add `CMD_SHOW_DASHBOARD` constant |
| `package.json` | **Edit** | Add command definition for `orchard.showDashboard` |
| `webpack.config.js` | **Edit** | Add multi-entry for webview bundle; add HtmlWebpackPlugin for webview HTML |
| `src/views/groveTreeDataProvider.ts` | **Unchanged** | Keep for sidebar |
| `src/views/groveTreeItem.ts` | **Unchanged** | Keep |
| `src/views/statusBar.ts` | **Unchanged** | Keep |

---

## Error Handling

- All postMessage request handlers wrapped in try/catch, return `{ success: false, error: string }`
- Webview shows inline error alerts (red banner with message and optional retry button)
- Network errors (Trellis unreachable) show "Connection to Orchard server lost" with retry
- SSE disconnection shows a subtle "Reconnecting..." indicator, not a blocking error

## Theme Awareness

The webview styles use VS Code's CSS custom properties:
- `--vscode-editor-background`
- `--vscode-editor-foreground`
- `--vscode-input-border`
- etc.

Status chip colors are defined in CSS and match the Canopy color scheme. No external CSS framework — plain CSS with VS Code theme variable support.
