import { GroveState } from '../api/types';

/** States where the grove is transitioning (SSE should be subscribed). */
export function isTransitionalState(state: GroveState): boolean {
  return ['PREPARING', 'PLANTING', 'GROWING', 'CLEARING'].includes(state);
}

/** States where the grove has reached a final/stable state. */
export function isTerminalState(state: GroveState): boolean {
  return ['FLOURISHING', 'DORMANT', 'CLEARED', 'BLIGHTED'].includes(state);
}

/** Human-readable label for display. */
export function stateDisplayLabel(state: GroveState): string {
  return state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
}

/** Machine size options for the create grove QuickPick. */
export const MACHINE_SIZES = [
  { label: 'Small', description: '2 CPU, 4 GB RAM, 20 GB disk', value: 'small' as const },
  { label: 'Medium', description: '4 CPU, 8 GB RAM, 40 GB disk', value: 'medium' as const },
  { label: 'Large', description: '8 CPU, 16 GB RAM, 80 GB disk', value: 'large' as const },
];
