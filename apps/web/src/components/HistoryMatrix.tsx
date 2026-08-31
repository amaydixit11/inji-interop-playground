import { useMemo, useState } from 'react';
import type { RunRecord } from '@interop/shared';
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
  onExport,
}: {
  runs: RunRecord[];
  onSelect: (run: RunRecord) => void;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all');

  const visible = useMemo(
    () => (filter === 'all' ? runs : runs.filter((run) => run.status === filter)),
    [runs, filter],
  );

  return (
    <Panel
      title="Interoperability matrix"
      subtitle={`${runs.length} recorded run(s)`}
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
              {['Result', 'Issuer', 'Wallet', 'Verifier', 'Format', 'Fault', 'Checks', 'When'].map((heading) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** Renders the matrix as Markdown for pasting into a report or an issue. */
export function toMarkdown(runs: RunRecord[]): string {
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
