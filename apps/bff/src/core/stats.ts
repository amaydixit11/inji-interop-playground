import type { CheckStatus, RunRecord, RunStats, StatBucket, StepId, StepTimings } from '@interop/shared';

/**
 * Aggregates the run history into something that answers "what usually breaks".
 *
 * Medians rather than means throughout: a single run that waited two minutes for
 * someone to scan a QR code would drag an average far enough to be useless,
 * while the median still describes the typical run.
 */
export function computeStats(runs: RunRecord[]): RunStats {
  const durations = runs.map((run) => run.summary?.durationMs ?? 0).filter((value) => value > 0);

  const stepMedians: StepTimings = {};
  for (const step of ['discover', 'offer', 'issue', 'present', 'verify'] as StepId[]) {
    const values = runs
      .map((run) => run.summary?.stepDurations?.[step])
      .filter((value): value is number => typeof value === 'number');
    if (values.length > 0) stepMedians[step] = percentile(values, 50);
  }

  return {
    total: runs.length,
    passed: runs.filter((run) => run.status === 'passed').length,
    failed: runs.filter((run) => run.status !== 'passed').length,
    durationP50: percentile(durations, 50),
    durationP95: percentile(durations, 95),
    stepMedians,
    byFormat: bucket(runs, (run) => run.config.format),
    byIssuer: bucket(runs, (run) => run.participants.issuer.label),
    byVerifier: bucket(runs, (run) => run.participants.verifier.label),
    byFault: bucket(runs, (run) => run.config.tamper),
    topFindings: topFindings(runs),
  };
}

function bucket(runs: RunRecord[], key: (run: RunRecord) => string): StatBucket[] {
  const groups = new Map<string, RunRecord[]>();
  for (const run of runs) {
    // A run recorded before a dimension existed has no value for it; labelling
    // that "(unset)" is clearer than an unlabelled bar.
    const value = key(run) || '(unset)';
    groups.set(value, [...(groups.get(value) ?? []), run]);
  }

  return [...groups.entries()]
    .map(([value, group]) => ({
      key: value,
      total: group.length,
      passed: group.filter((run) => run.status === 'passed').length,
      durationP50: percentile(
        group.map((run) => run.summary?.durationMs ?? 0).filter((duration) => duration > 0),
        50,
      ),
    }))
    // Worst success rate first: the reason to open this view is to find what
    // is failing, not to admire what passes.
    .sort((a, b) => a.passed / a.total - b.passed / b.total || b.total - a.total);
}

/**
 * The checks that most often fail or warn.
 *
 * Expected failures are excluded: a fault-injection run is *supposed* to trip
 * checks, and counting those would bury the real problems under the tests that
 * are working correctly.
 */
function topFindings(runs: RunRecord[]): RunStats['topFindings'] {
  const counts = new Map<string, { title: string; status: CheckStatus; count: number; spec: string }>();

  for (const run of runs) {
    for (const check of run.checks) {
      if (check.expected) continue;
      if (check.status !== 'fail' && check.status !== 'warn') continue;
      const key = `${check.status}|${check.title}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { title: check.title, status: check.status, count: 1, spec: check.spec });
    }
  }

  return [...counts.values()]
    .sort((a, b) => (a.status === b.status ? b.count - a.count : a.status === 'fail' ? -1 : 1))
    .slice(0, 12);
}

/** Nearest-rank percentile; returns 0 for an empty set. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}
