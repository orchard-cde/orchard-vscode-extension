import React, { useState, useEffect } from 'react';
import type { GroveResponse } from '../../api/types';
import type { WebviewResponse, SseEvent } from '../types';
import { StatusChip } from './StatusChip';
import { GroveStateStepper } from './GroveStateStepper';
import { SshConfigBlock } from './SshConfigBlock';

interface GroveDetailViewProps {
  groveId: string;
  onBack: () => void;
  postMessage: (type: string, payload?: Record<string, unknown>) => void;
}

export function GroveDetailView({ groveId, onBack, postMessage }: GroveDetailViewProps): React.ReactElement {
  const [grove, setGrove] = useState<GroveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [sshConfig, setSshConfig] = useState<string | undefined>();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const handler = (event: MessageEvent<WebviewResponse>) => {
      const msg = event.data;
      if (msg.type === 'getGrove') {
        if (msg.success) {
          setGrove(msg.data as GroveResponse);
          setLoading(false);
          setError(undefined);
        } else {
          setLoading(false);
          setError(msg.error);
        }
      } else if (msg.type === 'groveStateChanged') {
        const sse = msg.data as SseEvent;
        if (sse.groveId === groveId) {
          setGrove((prev) => prev ? { ...prev, state: sse.newState } : prev);
          if (sse.newState === 'FLOURISHING') {
            postMessage('getSshConfig', { id: groveId });
          }
        }
      } else if (msg.type === 'getSshConfig') {
        if (msg.success) {
          setSshConfig(msg.data as string);
        }
      } else if (msg.type === 'stopGrove' || msg.type === 'startGrove') {
        if (msg.success) {
          setGrove(msg.data as GroveResponse);
          const action = msg.type === 'stopGrove' ? 'stopped' : 'started';
          showToast(`Grove ${action}`, 'success');
        } else {
          showToast(`Action failed: ${msg.error}`, 'error');
        }
      }
    };

    window.addEventListener('message', handler);
    postMessage('getGrove', { id: groveId });

    return () => window.removeEventListener('message', handler);
  }, [groveId, postMessage]);

  useEffect(() => {
    if (grove && grove.seedling?.ipAddress) {
      postMessage('getSshConfig', { id: groveId });
    }
  }, [grove?.seedling?.ipAddress, groveId, postMessage]);

  const handleStop = () => {
    postMessage('stopGrove', { id: groveId });
  };

  const handleStart = () => {
    postMessage('startGrove', { id: groveId });
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p>Loading grove details...</p>
      </div>
    );
  }

  if (error || !grove) {
    return (
      <div className="error-state">
        <p>⚠ {error || 'Grove not found'}</p>
        <button className="btn" onClick={onBack}>← Back to Groves</button>
      </div>
    );
  }

  return (
    <>
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← Back to Groves</button>
      </div>

      <div className="detail-header">
        <h1>{grove.name}</h1>
        <StatusChip state={grove.state} />
      </div>

      <div className="detail-section">
        <h3>Status</h3>
        <GroveStateStepper state={grove.state} />
      </div>

      <div className="detail-section">
        <h3>Repository</h3>
        <p>{grove.repositoryUrl}</p>
        <p style={{ color: 'var(--color-muted)', fontSize: 12 }}>Branch: {grove.branch}</p>
      </div>

      {grove.seedling && (
        <div className="detail-section">
          <h3>Resources</h3>
          <div className="resource-chips">
            <span className="resource-chip">{grove.seedling.cpuCores} CPU</span>
            <span className="resource-chip">{(grove.seedling.memoryMb / 1024).toFixed(0)} GB RAM</span>
            <span className="resource-chip">{grove.seedling.diskGb} GB Disk</span>
          </div>
        </div>
      )}

      {grove.state === 'FLOURISHING' && (
        <div className="detail-section">
          <h3>Actions</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => postMessage('connectGrove', { id: groveId })}>Connect</button>
            <button className="btn" onClick={handleStop}>Stop Grove</button>
          </div>
        </div>
      )}

      {grove.state === 'DORMANT' && (
        <div className="detail-section">
          <h3>Actions</h3>
          <button className="btn" onClick={handleStart}>Start Grove</button>
        </div>
      )}

      {sshConfig && (
        <div className="detail-section">
          <h3>SSH Access</h3>
          <SshConfigBlock config={sshConfig} />
        </div>
      )}

      {grove.state === 'BLIGHTED' && (
        <div className="detail-section" style={{ color: 'var(--color-error)' }}>
          <p>This grove has been blighted. Delete it and plant a new one to recover.</p>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </>
  );
}
