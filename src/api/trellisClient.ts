import { AuthProvider } from './auth/authProvider';
import {
  CultivatorResponse,
  CreateGroveRequest,
  GroveResponse,
  HealthResponse,
  ReadinessResponse,
  TrellisApiError,
} from './types';

export interface ITrellisClient {
  getMe(): Promise<CultivatorResponse>;
  listGroves(): Promise<GroveResponse[]>;
  getGrove(id: string): Promise<GroveResponse>;
  createGrove(request: CreateGroveRequest): Promise<GroveResponse>;
  deleteGrove(id: string): Promise<void>;
  stopGrove(id: string): Promise<GroveResponse>;
  startGrove(id: string): Promise<GroveResponse>;
  getSshConfig(id: string): Promise<string>;
  getHealth(): Promise<HealthResponse>;
  getReadiness(): Promise<ReadinessResponse>;
}

export class TrellisClient implements ITrellisClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authProvider: AuthProvider,
  ) {}

  async getMe(): Promise<CultivatorResponse> {
    return this.request<CultivatorResponse>('GET', '/api/me');
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
    return this.request<GroveResponse>('POST', `/api/groves/${id}/actions/stop`);
  }

  async startGrove(id: string): Promise<GroveResponse> {
    return this.request<GroveResponse>('POST', `/api/groves/${id}/actions/start`);
  }

  async getSshConfig(id: string): Promise<string> {
    const response = await this.send('GET', `/api/groves/${id}/ssh-config`);
    return response.text();
  }

  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/api/health');
  }

  async getReadiness(): Promise<ReadinessResponse> {
    return this.request<ReadinessResponse>('GET', '/api/health/ready');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body, { 'Content-Type': 'application/json' });

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const attempt = async () => {
      const headers = { ...extraHeaders, ...(await this.authProvider.getHeaders()) };
      const options: RequestInit = { method, headers };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      const response = await fetch(`${this.baseUrl}${path}`, options);
      return { response, bearer: bearerOf(headers) };
    };

    let { response, bearer } = await attempt();

    if (response.status === 401 && bearer !== undefined) {
      this.authProvider.invalidate();
      ({ response, bearer } = await attempt());
    }

    if (response.status === 401) {
      if (this.authProvider.getMode() === 'enabled') {
        await this.authProvider.reportUnauthorized(
          bearer === undefined
            ? { tokenRejected: false }
            : { tokenRejected: true, rejectedAccessToken: bearer },
        );
      }
    } else if (response.ok && bearer !== undefined) {
      this.authProvider.reportAuthorized();
    }

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new TrellisApiError(response.status, response.statusText, message);
    }

    return response;
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

function bearerOf(headers: Record<string, string>): string | undefined {
  const value = headers['Authorization'];
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}
