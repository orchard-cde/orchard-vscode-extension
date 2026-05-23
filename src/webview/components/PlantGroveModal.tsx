import React, { useState } from 'react';

interface PlantGroveModalProps {
  onClose: () => void;
  onCreated: () => void;
  postMessage: (type: string, payload?: Record<string, unknown>) => void;
}

const MACHINE_SIZES = [
  { label: 'Small', description: '2 CPU, 4 GB RAM, 20 GB disk', value: 'small' },
  { label: 'Medium', description: '4 CPU, 8 GB RAM, 40 GB disk', value: 'medium' },
  { label: 'Large', description: '8 CPU, 16 GB RAM, 80 GB disk', value: 'large' },
];

export function PlantGroveModal({ onClose, onCreated, postMessage }: PlantGroveModalProps): React.ReactElement {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [name, setName] = useState('');
  const [machineSize, setMachineSize] = useState('small');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) { setError('Repository URL is required'); return; }

    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'createGrove') {
        window.removeEventListener('message', handler);
        if (msg.success) {
          onCreated();
        } else {
          setError(msg.error || 'Failed to create grove');
        }
      }
    };

    window.addEventListener('message', handler);
    postMessage('createGrove', {
      repositoryUrl: repoUrl.trim(),
      branch: branch.trim() || 'main',
      name: name.trim() || undefined,
      machineSize,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Plant a Grove</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Repository URL</label>
            <input
              type="text"
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={(e) => { setRepoUrl(e.target.value); setError(''); }}
            />
          </div>
          <div className="form-group">
            <label>Branch</label>
            <input
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Grove Name (optional)</label>
            <input
              type="text"
              placeholder="Auto-suggested from repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Machine Size</label>
            <select value={machineSize} onChange={(e) => setMachineSize(e.target.value)}>
              {MACHINE_SIZES.map((s) => (
                <option key={s.value} value={s.value}>{s.label} — {s.description}</option>
              ))}
            </select>
          </div>
          {error && <p style={{ color: 'var(--color-error)', fontSize: 12, marginBottom: 8 }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Plant Grove</button>
          </div>
        </form>
      </div>
    </div>
  );
}
