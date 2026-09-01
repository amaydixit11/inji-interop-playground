import { useCallback, useRef, useState } from 'react';
import type { RunConfig, RunRecord, Scenario } from '@interop/shared';
import { SCENARIOS, scenarioConfig } from '@interop/shared';
import { api } from '../api.js';

export interface BatchEntry {
  scenario: Scenario;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  detail?: string;
}

export interface BatchState {
  running: boolean;
  entries: BatchEntry[];
  /** Runs whose outcome differed from what the scenario said to expect. */
  surprises: number;
}

/**
 * Runs every unattended scenario in turn.
 *
 * Sequential rather than parallel: the runs share an issuer whose credential
 * offers and status list are per-process state, and interleaving them would
 * make a failure impossible to attribute. It is also the only order in which
 * the progress list means anything to someone watching.
 */
export function useBatch(onFinished: () => void): BatchState & {
  start: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  const start = useCallback(async () => {
    // Scenarios needing a person are skipped: a batch that stops waiting for
    // someone to scan a QR code is not a batch.
    const runnable = [...SCENARIOS].sort((a, b) => a.order - b.order).filter((s) => s.duration !== 'needs-a-phone');

    cancelled.current = false;
    setRunning(true);
    setEntries(runnable.map((scenario) => ({ scenario, status: 'pending' })));

    for (const [index, scenario] of runnable.entries()) {
      if (cancelled.current) {
        setEntries((current) =>
          current.map((entry, i) => (i >= index && entry.status === 'pending' ? { ...entry, status: 'skipped' } : entry)),
        );
        break;
      }

      setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, status: 'running' } : entry)));

      try {
        const record = await runToCompletion(scenarioConfig(scenario));
        const expectedFailure = scenario.expect.startsWith('Fails');
        const asExpected = expectedFailure ? record.status === 'failed' : record.status === 'passed';

        setEntries((current) =>
          current.map((entry, i) =>
            i === index
              ? {
                  ...entry,
                  status: record.status === 'passed' ? 'passed' : 'failed',
                  detail: asExpected
                    ? summarise(record)
                    : `Not what this scenario expected — ${summarise(record)}`,
                }
              : entry,
          ),
        );
      } catch (error) {
        setEntries((current) =>
          current.map((entry, i) =>
            i === index
              ? { ...entry, status: 'failed', detail: error instanceof Error ? error.message : String(error) }
              : entry,
          ),
        );
      }
    }

    setRunning(false);
    onFinished();
  }, [onFinished]);

  const surprises = entries.filter((entry) => entry.detail?.startsWith('Not what this scenario expected')).length;

  return {
    running,
    entries,
    surprises,
    start,
    cancel: () => {
      cancelled.current = true;
    },
    reset: () => setEntries([]),
  };
}

async function runToCompletion(config: RunConfig): Promise<RunRecord> {
  const { runId } = await api.start(config);
  const deadline = Date.now() + 120_000;

  // The record is written only once the run finishes, so its presence is the
  // completion signal — no separate status endpoint needed.
  while (Date.now() < deadline) {
    try {
      return await api.run(runId);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error('Run did not complete within 120s');
}

function summarise(record: RunRecord): string {
  const s = record.summary;
  if (!s) return record.status;
  const parts = [`${s.checksPassed} passed`];
  if (s.checksFailed > 0) parts.push(`${s.checksFailed} failed`);
  if (s.checksExpectedFailures > 0) parts.push(`${s.checksExpectedFailures} expected`);
  if (s.checksWarned > 0) parts.push(`${s.checksWarned} warned`);
  return `${parts.join(' · ')} · ${s.durationMs}ms`;
}
