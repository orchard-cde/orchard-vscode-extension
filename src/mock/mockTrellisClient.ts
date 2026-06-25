import { ITrellisClient } from '../api/trellisClient';
import {
  CreateGroveRequest,
  CultivatorResponse,
  GroveResponse,
  GroveState,
  HealthResponse,
  ReadinessResponse,
} from '../api/types';
import { mockCultivator, mockGroves, mockSshConfig, withState } from './fixtures';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory ITrellisClient used when ORCHARD_MOCK=1. Mutations (create/delete/
 * stop/start) persist for the session so the UI reflects actions.
 */
export class MockTrellisClient implements ITrellisClient {
  private groves: GroveResponse[] = mockGroves.map((g) => ({ ...g }));

  async getMe(): Promise<CultivatorResponse> {
    await delay(50);
    return mockCultivator;
  }

  async listGroves(): Promise<GroveResponse[]> {
    await delay(150);
    return this.groves.map((g) => ({ ...g }));
  }

  async getGrove(id: string): Promise<GroveResponse> {
    await delay(50);
    const found = this.groves.find((g) => g.id === id);
    if (!found) {
      throw new Error(`Mock: grove ${id} not found`);
    }
    return { ...found };
  }

  async createGrove(request: CreateGroveRequest): Promise<GroveResponse> {
    await delay(200);
    const created: GroveResponse = {
      id: `g-${Date.now()}`,
      name: request.name ?? 'new-grove',
      repositoryUrl: request.repositoryUrl,
      branch: request.branch ?? 'main',
      commitSha: null,
      state: 'PREPARING',
      sshConnectionString: null,
      seedling: null,
      fruits: [],
      plantedAt: new Date().toISOString(),
      lastAccessedAt: null,
    };
    this.groves.push(created);
    return { ...created };
  }

  async deleteGrove(id: string): Promise<void> {
    await delay(100);
    this.groves = this.groves.filter((g) => g.id !== id);
  }

  async stopGrove(id: string): Promise<GroveResponse> {
    await delay(100);
    return this.mutate(id, 'DORMANT');
  }

  async startGrove(id: string): Promise<GroveResponse> {
    await delay(100);
    return this.mutate(id, 'FLOURISHING');
  }

  async getSshConfig(_id: string): Promise<string> {
    await delay(50);
    return mockSshConfig;
  }

  async getHealth(): Promise<HealthResponse> {
    return { status: 'UP', name: 'orchard-mock', version: '0.0.0-mock' };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    return { status: 'READY', seedlingProvider: { id: 'mock', available: true } };
  }

  private mutate(id: string, state: GroveState): GroveResponse {
    const idx = this.groves.findIndex((g) => g.id === id);
    if (idx === -1) {
      throw new Error(`Mock: grove ${id} not found`);
    }
    this.groves[idx] = withState(this.groves[idx], state);
    return { ...this.groves[idx] };
  }
}
