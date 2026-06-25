import {
  CultivatorResponse,
  GroveResponse,
  GroveState,
  SeedlingInfo,
} from '../api/types';

const sampleSeedling: SeedlingInfo = {
  id: 'seed-001',
  state: 'RUNNING',
  ipAddress: '10.0.0.12',
  sshPort: 22,
  cpuCores: 4,
  memoryMb: 8192,
  diskGb: 80,
};

function makeGrove(
  overrides: Partial<GroveResponse> & Pick<GroveResponse, 'id' | 'name' | 'state'>,
): GroveResponse {
  return {
    repositoryUrl: 'https://github.com/orchard-cde/example.git',
    branch: 'main',
    commitSha: 'a1b2c3d4',
    sshConnectionString: null,
    seedling: null,
    fruits: [],
    plantedAt: '2026-06-20T10:00:00Z',
    lastAccessedAt: null,
    ...overrides,
  };
}

export const mockGroves: GroveResponse[] = [
  makeGrove({ id: 'g-preparing', name: 'preparing-grove', state: 'PREPARING', commitSha: null }),
  makeGrove({ id: 'g-planting', name: 'planting-grove', state: 'PLANTING' }),
  makeGrove({ id: 'g-growing', name: 'growing-grove', state: 'GROWING' }),
  makeGrove({
    id: 'g-flourishing',
    name: 'flourishing-grove',
    state: 'FLOURISHING',
    sshConnectionString: 'ssh cultivator@10.0.0.12 -p 22',
    seedling: sampleSeedling,
    fruits: [
      { id: 'fruit-1', state: 'RUNNING', containerId: 'c1', containerName: 'web', serviceName: 'web' },
      { id: 'fruit-2', state: 'RUNNING', containerId: 'c2', containerName: 'db', serviceName: 'postgres' },
    ],
    lastAccessedAt: '2026-06-24T18:30:00Z',
  }),
  makeGrove({
    id: 'g-dormant',
    name: 'dormant-grove',
    state: 'DORMANT',
    seedling: { ...sampleSeedling, id: 'seed-002', state: 'STOPPED', ipAddress: null },
    lastAccessedAt: '2026-06-22T09:00:00Z',
  }),
  makeGrove({ id: 'g-clearing', name: 'clearing-grove', state: 'CLEARING' }),
  makeGrove({ id: 'g-cleared', name: 'cleared-grove', state: 'CLEARED' }),
  makeGrove({ id: 'g-blighted', name: 'blighted-grove', state: 'BLIGHTED', commitSha: null }),
];

export const mockCultivator: CultivatorResponse = {
  id: 'cult-001',
  username: 'demo',
  email: 'demo@orchard.dev',
  provider: 'github',
  avatarUrl: null,
  displayName: 'Demo Cultivator',
  createdAt: '2026-01-01T00:00:00Z',
  lastActiveAt: '2026-06-25T12:00:00Z',
};

export const mockSshConfig = `Host orchard-flourishing-grove
  HostName 10.0.0.12
  User cultivator
  Port 22
  IdentityFile ~/.ssh/orchard_ed25519
`;

export function withState(grove: GroveResponse, state: GroveState): GroveResponse {
  return { ...grove, state };
}
