import type { Participant, RunConfig, RunListItem, RunRecord, RunStats, StampedRunEvent } from '@interop/shared';

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? 'GET'} ${input} failed: ${response.status} ${body}`);
  }
  return (await response.json()) as T;
}

export const api = {
  participants: () => json<{ participants: Participant[]; publicUrl: string }>('/api/participants'),
  runs: () => json<{ runs: RunListItem[] }>('/api/runs'),
  stats: () => json<RunStats>('/api/stats'),
  run: (id: string) => json<RunRecord>(`/api/runs/${id}`),
  events: (id: string) => json<{ events: StampedRunEvent[] }>(`/api/runs/${id}/events`),
  start: (config: RunConfig) =>
    json<{ runId: string }>('/api/runs', { method: 'POST', body: JSON.stringify(config) }),
  completeAction: (runId: string, actionId: string) =>
    json<{ status: string }>(`/api/runs/${runId}/actions/${actionId}`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  abort: (runId: string) => json<{ status: string }>(`/api/runs/${runId}/abort`, { method: 'POST' }),
};
