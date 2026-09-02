import { useMemo, useState } from 'react';
import type { RunListItem } from '@interop/shared';
import { CREDENTIAL_FORMAT_LABELS } from '@interop/shared';
import { Badge, Panel, runTone } from './primitives.js';

/**
 * The interoperability matrix: one row per run, filterable.
 *
 * This is the artefact the exercise is ultimately for — a record of which
 * combinations were tried and what happened, durable enough to diff across Inji
 * releases and to attach to a bug report.
 */
export function HistoryMatrix({
  runs,
  onSelect,
  onOpenStory,
  onExport,
}: {
  runs: RunListItem[];
  onSelect: (run: RunListItem) => void;
  onOpenStory: (run: RunListItem) => void;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [format, setFormat] = useState('all');
  const [build, setBuild] = useState('all');

  // Filter options come from the history rather than a fixed list, so a
  // dimension that has never been exercised does not appear as an empty choice.
  const formats = useMemo(() => [...new Set(runs.map((run) => run.config.format))].sort(), [runs]);
  const builds = useMemo(
    () => [...new Set(runs.map(buildLabel))].sort(),
    [runs],
  );

  const visible = useMemo(
    () =>
      runs
        .filter((run) => filter === 'all' || run.status === filter)
        .filter((run) => format === 'all' || run.config.format === format)
        .filter((run) => build === 'all' || buildLabel(run) === build),
    [runs, filter, format, build],
  );

  return (
    <Panel
      title="Interoperability matrix"
      subtitle={`${runs.length} recorded run(s) · click a row to reload its configuration`}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-md border border-line bg-surface-2 p-0.5">
            {(['all', 'passed', 'failed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded px-2 py-0.5 text-[10.5px] font-medium capitalize transition ${
                  filter === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            title="Filter by credential format"
            className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted outline-none focus:border-accent"
          >
            <option value="all">any format</option>
            {formats.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={build}
            onChange={(event) => setBuild(event.target.value)}
            title="Filter by the participant builds a run exercised"
            className="max-w-[190px] rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted outline-none focus:border-accent"
          >
            <option value="all">any build</option>
            {builds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onExport}
            disabled={runs.length === 0}
            className="rounded border border-line px-2 py-0.5 text-[10.5px] text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            export markdown
          </button>
        </div>
      }
      className="h-full"
    >
      {visible.length === 0 ? (
        <p className="p-4 text-[11.5px] text-muted">
          {runs.length === 0 ? 'Completed runs are recorded here.' : 'No runs match this filter.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-wider text-muted">
            <tr>
              {['Result', 'Issuer', 'Wallet', 'Verifier', 'Format', 'Build', 'Fault', 'Checks', 'When', ''].map((heading) => (
                <th key={heading} className="border-b border-line px-2.5 py-1.5 text-left font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((run) => (
              <tr
                key={run.id}
                onClick={() => onSelect(run)}
                className="cursor-pointer border-b border-line/40 transition hover:bg-surface-2"
              >
                <td className="px-2.5 py-1.5">
                  <Badge tone={runTone(run.status)}>{run.status}</Badge>
                </td>
                <td className="px-2.5 py-1.5 text-ink">{run.participants.issuer.label}</td>
                <td className="px-2.5 py-1.5 text-ink">
                  {run.participants.wallet.label}
                  {run.traceability === 'endpoint-only' && (
                    <span
                      title="Some exchanges in this run were not captured, so it is weaker evidence than a fully traced run."
                      className="ml-1 text-warn"
                    >
                      *
                    </span>
                  )}
                </td>
                <td className="px-2.5 py-1.5 text-ink">{run.participants.verifier.label}</td>
                <td className="px-2.5 py-1.5 text-muted" title={CREDENTIAL_FORMAT_LABELS[run.config.format]}>
                  {run.config.format}
                </td>
                <td className="max-w-[170px] truncate px-2.5 py-1.5 text-muted" title={buildLabel(run)}>
                  {buildLabel(run)}
                </td>
                <td className="px-2.5 py-1.5 text-muted">{run.config.tamper}</td>
                <td className="px-2.5 py-1.5 text-muted">
                  <span className="text-pass">{run.summary?.checksPassed ?? 0}</span>
                  {' / '}
                  <span className={run.summary?.checksFailed ? 'text-fail' : ''}>
                    {run.summary?.checksFailed ?? 0}
                  </span>
                  {run.summary?.checksWarned ? <span className="text-warn"> / {run.summary.checksWarned}</span> : null}
                </td>
                <td className="px-2.5 py-1.5 text-muted">{new Date(run.startedAt).toLocaleString()}</td>
                <td className="px-2.5 py-1.5">
                  {run.narrative && (
                    <button
                      type="button"
                      onClick={(event) => {
                        // The row itself reloads the configuration; this opens
                        // the run instead, so both are reachable.
                        event.stopPropagation();
                        onOpenStory(run);
                      }}
                      className="whitespace-nowrap rounded border border-line px-1.5 py-0.5 text-[10px] text-muted transition hover:border-accent hover:text-accent"
                    >
                      read it
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Renders the matrix as Markdown for pasting into a report or an issue. */
export function toMarkdown(runs: RunListItem[]): string {
  const header = [
    '# Inji Interoperability Report',
    '',
    `Generated ${new Date().toISOString()} · ${runs.length} run(s)`,
    '',
    '| Result | Issuer | Wallet | Verifier | Format | Fault injected | Pass | Fail | Warn | Traceability |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  const rows = runs.map((run) =>
    [
      run.status,
      run.participants.issuer.label,
      run.participants.wallet.label,
      run.participants.verifier.label,
      run.config.format,
      run.config.tamper,
      String(run.summary?.checksPassed ?? 0),
      String(run.summary?.checksFailed ?? 0),
      String(run.summary?.checksWarned ?? 0),
      run.traceability,
    ]
      .map((cell) => `| ${cell} `)
      .join('') + '|',
  );

  const findings = runs.flatMap((run) =>
    run.checks
      .filter((check) => (check.status === 'fail' && !check.expected) || check.status === 'warn')
      .map((check) => `- **${check.title}** (${check.status}, ${check.spec}) — ${check.detail}`),
  );

  const unique = [...new Set(findings)];

  return [
    ...header,
    ...rows,
    '',
    '## Findings',
    '',
    unique.length > 0 ? unique.join('\n') : 'No failures or warnings were recorded.',
    '',
    '> Runs marked `endpoint-only` involve a wallet the playground cannot observe directly.',
    '> Their endpoint behaviour is verified, but the wallet-side payloads are not captured.',
    '',
  ].join('\n');
}

/**
 * The builds a run exercised, as a short label.
 *
 * Only the issuer and verifier: the wallet is the playground's own in most runs,
 * so including it would make every label differ by a constant. Runs with nothing
 * discoverable are grouped rather than hidden — not knowing what you tested is
 * the finding, not a reason to omit the row.
 */
function buildLabel(run: RunListItem): string {
  const relevant = (run.versions ?? []).filter((version) => version.role !== 'wallet');
  if (relevant.length === 0) return 'unknown';
  return relevant.map((version) => `${version.participantId} ${version.value ?? '?'}`).join(' · ');
}
