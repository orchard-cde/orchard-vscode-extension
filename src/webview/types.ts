import type { GroveState } from '../api/types';

export interface WebviewRequest {
  type: string;
  payload?: Record<string, unknown>;
}

export interface WebviewResponse {
  type: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SseEvent {
  groveId: string;
  groveName: string;
  previousState: GroveState;
  newState: GroveState;
  changedAt: string;
}
