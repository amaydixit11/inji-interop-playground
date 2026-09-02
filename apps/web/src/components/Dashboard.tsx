import { useEffect, useMemo, useState } from 'react';
import type { RunListItem, RunStats, StatBucket, StepId } from '@interop/shared';
import { STEP_LABELS } from '@interop/shared';
import { api } from '../api.js';
import { Badge, checkTone, Panel } from './primitives.js';

/**
 * Aggregate view over the run history: what passes, what fails, and how long it
 * takes.
 *
 * Deliberately not a wall of charts. The headline numbers are stat tiles because
 * a single value reads faster as text than as a plotted point, and the
 * comparisons are plain horizontal bars because every one of them is the same
 * question — one measure across a handful of named buckets.
 *
 * All bars share a single hue. Success rate is a magnitude, not a set of
 * identities, so colouring each bucket differently would imply a distinction
 * that is not there; and a green/amber/red scale would put the whole reading on
 * a hue pair that protanopic readers cannot separate. Order carries the
 * judgement instead — worst first — and every bar is labelled with its value.
 */
export function Dashboard({ runs }: { runs: RunListItem[] }) {
  const [stats, setStats] = useState<RunStats>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch((caught: Error) => setError(caught.message));
  }, [runs.length]);

  if (error) return <Panel title="Dashboard"><p className="p-4 text-[12px] text-fail">{error}</p></Panel>;
  if (!stats) return <Panel title="Dashboard"><p className="p-4 text-[12px] text-muted">Loading…</p></Panel>;
  if (stats.total === 0) {
    return (
      <Panel title="Dashboard">
        <p className="p-4 text-[12px] text-muted">No runs recorded yet. Run an interoperability test first.</p>
      </Panel>
    );
  }

  const passRate = Math.round((stats.passed / stats.total) * 100);

  return (
    <div className="space-y-3 pb-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Runs recorded" value={String(stats.total)} />
        <Tile label="Pass rate" value={`${passRate}%`} note={`${stats.passed} passed · ${stats.failed} failed`} />
        <Tile label="Median run" value={formatMs(stats.durationP50)} note="end to end" />
        <Tile label="95th percentile" value={formatMs(stats.durationP95)} note="slowest 1 in 20" />
        <Tile
          label="Slowest phase"
          value={slowestStep(stats.stepMedians)?.label ?? '—'}
          note={slowestStep(stats.stepMedians) ? formatMs(slowestStep(stats.stepMedians)!.ms) : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <BucketPanel title="Pass rate by credential format" buckets={stats.byFormat} />
        <BucketPanel title="Pass rate by fault injected" buckets={stats.byFault} />
        <BucketPanel title="Pass rate by issuer" buckets={stats.byIssuer} />
        <BucketPanel title="Pass rate by verifier" buckets={stats.byVerifier} />
        <BucketPanel title="Pass rate by participant build" buckets={stats.byVersion} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Median time per phase" subtitle="Where a run actually spends its time">
          <div className="space-y-2 p-3">
            {(Object.keys(stats.stepMedians) as StepId[]).map((step) => {
              const value = stats.stepMedians[step] ?? 0;
              const max = Math.max(...Object.values(stats.stepMedians), 1);
              return (
                <Bar
                  key={step}
                  label={STEP_LABELS[step]}
                  fraction={value / max}
                  value={formatMs(value)}
                  title={`${STEP_LABELS[step]}: median ${formatMs(value)}`}
                />
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Most frequent findings"
          subtitle="Deliberately provoked failures excluded"
        >
          {stats.topFindings.length === 0 ? (
            <p className="p-4 text-[12px] text-muted">No failures or warnings recorded.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {stats.topFindings.map((finding) => (
                <li key={`${finding.status}-${finding.title}`} className="flex items-start gap-2 px-3 py-2">
                  <Badge tone={checkTone(finding.status)}>{finding.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] leading-snug text-ink">{finding.title}</div>
                    <div className="text-[10px] text-muted">{finding.spec}</div>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted">
                    {finding.count}
                    <span className="ml-1 text-[10px]">×</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-tight tabular-nums text-ink">{value}</div>
      {note && <div className="text-[10.5px] text-muted">{note}</div>}
    </div>
  );
}

function BucketPanel({ title, buckets }: { title: string; buckets: StatBucket[] }) {
  return (
    <Panel title={title} subtitle="Worst first">
      <div className="space-y-2 p-3">
        {buckets.map((bucket) => {
          const rate = bucket.passed / bucket.total;
          return (
            <Bar
              key={bucket.key}
              label={bucket.key}
              fraction={rate}
              value={`${Math.round(rate * 100)}%`}
              note={`${bucket.passed}/${bucket.total} · ${formatMs(bucket.durationP50)}`}
              title={`${bucket.key}: ${bucket.passed} of ${bucket.total} runs passed, median ${formatMs(bucket.durationP50)}`}
            />
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * One horizontal bar.
 *
 * The value is always written out beside it: colour and length alone would
 * leave the reading inaccessible to anyone who cannot separate the hue from the
 * track, and a number is more precise than a length anyway.
 */
function Bar({
  label,
  fraction,
  value,
  note,
  title,
}: {
  label: string;
  fraction: number;
  value: string;
  note?: string;
  title: string;
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div title={title} className="group">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-ink">{label}</span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-ink">{value}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-surface-2">
          <div
            className="h-full rounded-sm bg-accent transition-[width] duration-300 group-hover:brightness-110"
            style={{ width: `${width}%` }}
          />
        </div>
        {note && <span className="shrink-0 text-[10px] tabular-nums text-muted">{note}</span>}
      </div>
    </div>
  );
}

function slowestStep(medians: Partial<Record<StepId, number>>): { label: string; ms: number } | undefined {
  const entries = Object.entries(medians) as Array<[StepId, number]>;
  if (entries.length === 0) return undefined;
  const [step, ms] = entries.reduce((worst, entry) => (entry[1] > worst[1] ? entry : worst));
  return { label: STEP_LABELS[step], ms };
}

function formatMs(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
