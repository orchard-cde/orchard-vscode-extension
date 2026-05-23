import React, { useState, useEffect, useCallback } from 'react';
import type { GroveResponse } from '../api/types';
import type { WebviewResponse, SseEvent } from './types';
import { DashboardView } from './components/DashboardView';
import { GroveDetailView } from './components/GroveDetailView';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

interface AppState {
  view: 'dashboard' | 'detail';
  selectedGroveId: string | undefined;
  groves: GroveResponse[];
  loading: boolean;
  error: string | undefined;
}

export function App(): React.ReactElement {
  const [state, setState] = useState<AppState>({
    view: 'dashboard',
    selectedGroveId: undefined,
    groves: [],
    loading: true,
    error: undefined,
  });

  const postMessage = useCallback((type: string, payload?: Record<string, unknown>) => {
    vscode.postMessage({ type, payload });
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent<WebviewResponse>) => {
      const msg = event.data;
      if (msg.type === 'groveStateChanged') {
        const sse = msg.data as SseEvent;
        setState((prev) => ({
          ...prev,
          groves: prev.groves.map((g) =>
            g.id === sse.groveId ? { ...g, state: sse.newState } : g,
          ),
        }));
      } else if (msg.type === 'groveListChanged') {
        setState((prev) => ({
          ...prev,
          groves: msg.data as GroveResponse[],
          loading: false,
        }));
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    postMessage('listGroves');
    const handler = (event: MessageEvent<WebviewResponse>) => {
      const msg = event.data;
      if (msg.type === 'listGroves') {
        if (msg.success) {
          setState((prev) => ({ ...prev, groves: msg.data as GroveResponse[], loading: false, error: undefined }));
        } else {
          setState((prev) => ({ ...prev, loading: false, error: msg.error }));
        }
      } else if (msg.type === 'navigateToGrove') {
        const groveId = (msg.data as { groveId: string }).groveId;
        setState((prev) => ({ ...prev, view: 'detail', selectedGroveId: groveId }));
        window.location.hash = `#/grove/${groveId}`;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postMessage]);

  const navigateTo = useCallback((groveId: string) => {
    setState((prev) => ({ ...prev, view: 'detail', selectedGroveId: groveId }));
    window.location.hash = `#/grove/${groveId}`;
  }, []);

  const navigateBack = useCallback(() => {
    setState((prev) => ({ ...prev, view: 'dashboard', selectedGroveId: undefined }));
    window.location.hash = '#/';
    postMessage('listGroves');
  }, [postMessage]);

  const onRefresh = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    postMessage('listGroves');
  }, [postMessage]);

  return (
    <div className="app">
      {state.view === 'dashboard' ? (
        <DashboardView
          groves={state.groves}
          loading={state.loading}
          error={state.error}
          onNavigate={navigateTo}
          onRefresh={onRefresh}
          postMessage={postMessage}
        />
      ) : state.selectedGroveId ? (
        <GroveDetailView
          groveId={state.selectedGroveId}
          onBack={navigateBack}
          postMessage={postMessage}
        />
      ) : null}
    </div>
  );
}
