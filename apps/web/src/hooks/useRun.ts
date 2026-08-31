import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Artifact,
  ConformanceCheck,
  HttpExchange,
  RunConfig,
  RunStatus,
  RunSummary,
  StepId,
  StampedRunEvent,
  StepStatus,
  UserAction,
} from '@interop/shared';
import { api } from '../api.js';

export interface LiveRun {
  id: string;
  config: RunConfig;
  status: RunStatus;
  steps: Record<StepId, StepStatus>;
  exchanges: HttpExchange[];
  checks: ConformanceCheck[];
  artifacts: Artifact[];
  logs: Array<{ level: string; message: string; at: string }>;
  pendingAction?: UserAction;
  summary?: RunSummary;
}

const INITIAL_STEPS: Record<StepId, StepStatus> = {
  discover: 'pending',
  offer: 'pending',
  issue: 'pending',
  present: 'pending',
  verify: 'pending',
};

function reduce(run: LiveRun, event: StampedRunEvent): LiveRun {
  switch (event.type) {
    case 'run.started':
      return { ...run, config: event.config, status: 'running' };
    case 'step.status':
      return {
        ...run,
        steps: { ...run.steps, [event.step]: event.status },
        status: event.status === 'awaiting-user' ? 'awaiting-user' : run.status,
      };
    case 'http':
      // Exchanges are replaced by id rather than appended, so a reconnect that
      // replays the log cannot duplicate rows already on screen.
      return { ...run, exchanges: upsert(run.exchanges, event.exchange) };
    case 'check':
      return { ...run, checks: [...run.checks, event.check] };
    case 'artifact':
      return { ...run, artifacts: upsert(run.artifacts, event.artifact) };
    case 'log':
      return { ...run, logs: [...run.logs, { level: event.level, message: event.message, at: event.at }] };
    case 'user.action':
      return { ...run, pendingAction: event.action, status: 'awaiting-user' };
    case 'run.finished':
      return { ...run, status: event.status, summary: event.summary, pendingAction: undefined };
    default:
      return run;
  }
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

/**
 * Subscribes to the run event stream.
 *
 * The socket is opened once for the session rather than per run: runs are
 * started by an HTTP POST that returns immediately, and events for the new run
 * can arrive before the caller has finished awaiting that response.
 */
export function useRun(): {
  run: LiveRun | undefined;
  connected: boolean;
  start: (config: RunConfig) => Promise<void>;
  completeAction: () => Promise<void>;
  abort: () => Promise<void>;
  error?: string;
} {
  const [run, setRun] = useState<LiveRun | undefined>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const runIdRef = useRef<string>();
  const socketRef = useRef<WebSocket>();
  /** Highest event sequence applied, so nothing is applied twice or backwards. */
  const lastSeqRef = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data as string) as StampedRunEvent;
        // Events for an earlier run, or ones already applied, are ignored so a
        // stale stream cannot overwrite what is on screen.
        if (event.runId !== runIdRef.current || event.seq <= lastSeqRef.current) return;
        lastSeqRef.current = event.seq;
        setRun((current) => (current ? reduce(current, event) : current));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  const start = useCallback(async (config: RunConfig) => {
    setError(undefined);
    try {
      const { runId } = await api.start(config);
      runIdRef.current = runId;
      lastSeqRef.current = 0;
      setRun({
        id: runId,
        config,
        status: 'running',
        steps: { ...INITIAL_STEPS },
        exchanges: [],
        checks: [],
        artifacts: [],
        logs: [],
      });

      // Anything emitted between the POST and the socket filter picking up the
      // new id is recovered here. Events already applied from the socket are
      // skipped rather than replayed over newer state.
      const { events } = await api.events(runId);
      const missed = events.filter((event) => event.seq > lastSeqRef.current);
      if (missed.length > 0) {
        lastSeqRef.current = missed[missed.length - 1].seq;
        setRun((current) => (current ? missed.reduce(reduce, current) : current));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const completeAction = useCallback(async () => {
    const current = runIdRef.current;
    const action = run?.pendingAction;
    if (!current || !action) return;
    await api.completeAction(current, action.id);
    setRun((value) => (value ? { ...value, pendingAction: undefined, status: 'running' } : value));
  }, [run?.pendingAction]);

  const abort = useCallback(async () => {
    if (runIdRef.current) await api.abort(runIdRef.current);
  }, []);

  return useMemo(
    () => ({ run, connected, start, completeAction, abort, error }),
    [run, connected, start, completeAction, abort, error],
  );
}
