import React from 'react';
import type { GroveState } from '../../api/types';

interface StatusChipProps {
  state: GroveState;
}

const STATE_LABELS: Record<GroveState, string> = {
  PREPARING: 'Preparing',
  PLANTING: 'Planting',
  GROWING: 'Growing',
  FLOURISHING: 'Flourishing',
  DORMANT: 'Dormant',
  CLEARING: 'Clearing',
  CLEARED: 'Cleared',
  BLIGHTED: 'Blighted',
};

const STATE_CLASS: Record<GroveState, string> = {
  PREPARING: 'preparing',
  PLANTING: 'planting',
  GROWING: 'growing',
  FLOURISHING: 'flourishing',
  DORMANT: 'dormant',
  CLEARING: 'clearing',
  CLEARED: 'cleared',
  BLIGHTED: 'blighted',
};

export function StatusChip({ state }: StatusChipProps): React.ReactElement {
  return (
    <span className={`status-chip ${STATE_CLASS[state] || ''}`}>
      {STATE_LABELS[state] || state}
    </span>
  );
}
