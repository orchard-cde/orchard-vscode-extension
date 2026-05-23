import React from 'react';
import type { GroveResponse } from '../../api/types';
import { StatusChip } from './StatusChip';

interface GroveCardProps {
  grove: GroveResponse;
  onNavigate: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onConnect?: (id: string) => void;
}

function shortRepoName(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '');
  } catch { return repoUrl; }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) { return 'Never'; }
  try {
    return new Date(dateStr).toLocaleString();
  } catch { return dateStr; }
}

export function GroveCard({ grove, onNavigate, onDelete, onConnect }: GroveCardProps): React.ReactElement {
  return (
    <div className="card" onClick={() => onNavigate(grove.id)}>
      <div className="card-header">
        <span className="card-name">{grove.name}</span>
        <StatusChip state={grove.state} />
      </div>
      <div className="card-repo">{shortRepoName(grove.repositoryUrl)} ({grove.branch})</div>
      <div className="card-accessed">Last accessed: {formatDate(grove.lastAccessedAt)}</div>
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn" onClick={() => onNavigate(grove.id)}>Open</button>
        {grove.state === 'FLOURISHING' && onConnect && (
          <button className="btn" onClick={() => onConnect(grove.id)}>Connect</button>
        )}
        <button className="btn btn-danger" onClick={() => onDelete(grove.id, grove.name)}>Delete</button>
      </div>
    </div>
  );
}
