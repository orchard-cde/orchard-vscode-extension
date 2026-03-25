import { AuthProvider } from './auth/authProvider';
import {
  CultivatorResponse,
  CreateGroveRequest,
  GroveResponse,
  HealthResponse,
  ReadinessResponse,
  TrellisApiError,
} from './types';

export class TrellisClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authProvider: AuthProvider,
  ) {}

  async getMe(): Promise<CultivatorResponse> {
    return this.request<CultivatorResponse>('GET', '/api/cultivators/me');
  }

  async listGroves(): Promise<GroveResponse[]> {
    return this.request<GroveResponse[]>('GET', '/api/groves');
  }

  async getGrove(id: string): Promise<GroveResponse> {
    return this.request<GroveResponse>('GET', `/api/groves/${id}`);
  }

  async createGrove(request: CreateGroveRequest): Promise<GroveResponse> {
    return this.request<GroveResponse>('POST', '/api/groves', request);
  }

  async deleteGrove(id: string): Promise<void> {
    await this.request<void>('DELETE', `/api/groves/${id}`);
  }

  async stopGrove(id: string): Promise<GroveResponse> {
    return this.request<GroveResponse>('POST', `/api/groves/${id}/stop`);
  }

  async startGrove(id: string): Promise<GroveResponse> {
    return this.request<GroveResponse>('POST', `/api/groves/${id}/start`);
  }

  async getSshConfig(id: string): Promise<string> {
    const authHeaders = await this.authProvider.getHeaders();
    const response = await fetch(`${this.baseUrl}/api/groves/${id}/ssh-config`, {
      method: 'GET',
      headers: {
        ...authHeaders,
      },
    });

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new TrellisApiError(response.status, response.statusText, message);
    }

    return response.text();
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/actuator/health');
  }

  async getReadiness(): Promise<ReadinessResponse> {
    return this.request<ReadinessResponse>('GET', '/actuator/health/readiness');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const authHeaders = await this.authProvider.getHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeaders,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new TrellisApiError(response.status, response.statusText, message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async extractErrorMessage(response: Response): Promise<string> {
    try {
      const errorBody = await response.text();
      const parsed = JSON.parse(errorBody);
      return parsed.message || parsed.error || errorBody;
    } catch {
      return `${response.status} ${response.statusText}`;
    }
  }
}
