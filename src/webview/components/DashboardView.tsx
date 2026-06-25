import React, { useState } from 'react';
import { Sprout, RotateCw, Plus } from 'lucide-react';
import type { GroveResponse } from '../../api/types';
import { GroveCard } from './GroveCard';
import { PlantGroveModal } from './PlantGroveModal';
import { Button } from './common/Button';

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
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDeleteConfirm = () => {
    if (!confirmDelete) { return; }
    const { id, name } = confirmDelete;
    setConfirmDelete(null);

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
  };

  const handleDeleteCancel = () => {
    setConfirmDelete(null);
  };

  return (
    <>
      <div className="header">
        <h1>
          <Sprout size={20} className="header-icon" />
          Orchard
        </h1>
        <div className="header-actions">
          <Button variant="secondary" size="sm" onClick={onRefresh} loading={loading}><RotateCw size={14} /> Refresh</Button>
          <Button variant="primary" size="sm" onClick={() => setShowPlantModal(true)}><Plus size={14} /> Plant Grove</Button>
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
          <Button variant="secondary" size="sm" onClick={onRefresh}>Retry</Button>
        </div>
      ) : groves.length === 0 ? (
        <div className="empty-state">
          <p>No groves yet — plant your first grove</p>
          <Button variant="primary" size="sm" onClick={() => setShowPlantModal(true)}><Plus size={14} /> Plant Grove</Button>
        </div>
      ) : (
        <div className="card-grid">
          {groves.map((g) => (
            <GroveCard key={g.id} grove={g} onNavigate={onNavigate} onDelete={(id, name) => setConfirmDelete({ id, name })} onConnect={(id) => postMessage('connectGrove', { id })} />
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

      {confirmDelete && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Grove</h3>
            <p>Are you sure you want to delete '<strong>{confirmDelete.name}</strong>'? This action cannot be undone.</p>
            <div className="modal-actions">
              <Button variant="secondary" size="sm" onClick={handleDeleteCancel}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDeleteConfirm}>Delete</Button>
            </div>
          </div>
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
