// Grove types

export type GroveState =
  | 'PREPARING' | 'PLANTING' | 'GROWING' | 'FLOURISHING'
  | 'DORMANT' | 'CLEARING' | 'CLEARED' | 'BLIGHTED';

export interface SeedlingInfo {
  id: string;
  state: string;
  ipAddress: string | null;
  sshPort: number;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
}

export interface FruitInfo {
  id: string;
  state: string;
  containerId: string | null;
  containerName: string;
  serviceName: string | null;
}

export interface GroveResponse {
  id: string;
  name: string;
  repositoryUrl: string;
  branch: string;
  commitSha: string | null;
  state: GroveState;
  sshConnectionString: string | null;
  seedling: SeedlingInfo | null;
  fruits: FruitInfo[];
  plantedAt: string;
  lastAccessedAt: string | null;
}

export interface CreateGroveRequest {
  repositoryUrl: string;
  branch?: string;
  name?: string;
  machineSize?: 'small' | 'medium' | 'large';
}

export interface GroveStateChangedEvent {
  groveId: string;
  groveName: string;
  previousState: GroveState;
  newState: GroveState;
  changedAt: string;
}

// Cultivator types

export interface CultivatorResponse {
  id: string;
  username: string;
  email: string;
  provider: string;
  avatarUrl: string | null;
  displayName: string | null;
  createdAt: string;
  lastActiveAt: string;
}

// Health types

export interface HealthResponse {
  status: string;
  name: string;
  version: string;
}

export interface ReadinessResponse {
  status: string;
  seedlingProvider: {
    id: string;
    available: boolean;
  };
}

// Error types

export class TrellisApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    message: string,
  ) {
    super(message);
    this.name = 'TrellisApiError';
  }
}
