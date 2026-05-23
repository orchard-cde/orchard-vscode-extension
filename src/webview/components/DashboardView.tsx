import React, { useState } from 'react';
import type { GroveResponse } from '../../api/types';
import { GroveCard } from './GroveCard';
import { PlantGroveModal } from './PlantGroveModal';

interface DashboardViewProps {
  groves: GroveResponse[];
  loading: boolean;
  error: string | undefined;
  onNavigate: (id: string) => void;
  onRefresh: () => void;
  postMessage: (type: string, payload?: Record<string, unknown>) => void;
}

export function DashboardView({ groves, loading, error, onNavigate, onRefresh, postMessage }: DashboardViewProps): React.ReactElement {
  const [showPlantModal, setShowPlantModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete grove '${name}'? This action cannot be undone.`)) {
      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === 'deleteGrove') {
          window.removeEventListener('message', handler);
          if (msg.success) {
            showToast(`Grove '${name}' deleted`, 'success');
            onRefresh();
          } else {
            showToast(`Failed to delete: ${msg.error}`, 'error');
          }
        }
      };
      window.addEventListener('message', handler);
      postMessage('deleteGrove', { id });
    }
  };

  return (
    <>
      <div className="header">
        <h1>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C9.5 2 7.5 4 7.5 6.5c0 1.5.7 2.8 1.8 3.7C7.3 11.2 6 13.4 6 16h2c0-2.2 1.8-4 4-4s4 1.8 4 4h2c0-2.6-1.3-4.8-3.3-5.8 1.1-.9 1.8-2.2 1.8-3.7C16.5 4 14.5 2 12 2z" fill="#4CAF50"/>
            <rect x="11" y="16" width="2" height="6" rx="0.5" fill="#8B4513"/>
          </svg>
          Orchard
        </h1>
        <div className="header-actions">
          <button className="btn" onClick={onRefresh}>{loading ? '⟳' : '↻'} Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowPlantModal(true)}>+ Plant Grove</button>
        </div>
      </div>

      {loading && groves.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading groves...</p>
        </div>
      ) : error && groves.length === 0 ? (
        <div className="error-state">
          <p>⚠ {error}</p>
          <button className="btn" onClick={onRefresh}>Retry</button>
        </div>
      ) : groves.length === 0 ? (
        <div className="empty-state">
          <p>No groves yet — plant your first grove</p>
          <button className="btn btn-primary" onClick={() => setShowPlantModal(true)}>+ Plant Grove</button>
        </div>
      ) : (
        <div className="card-grid">
          {groves.map((g) => (
            <GroveCard key={g.id} grove={g} onNavigate={onNavigate} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showPlantModal && (
        <PlantGroveModal
          onClose={() => setShowPlantModal(false)}
          onCreated={() => { setShowPlantModal(false); onRefresh(); }}
          postMessage={postMessage}
        />
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </>
  );
}
