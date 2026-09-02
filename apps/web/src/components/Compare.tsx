import { useMemo, useState } from 'react';
import type { ConformanceCheck, RunListItem } from '@interop/shared';
import { Badge, checkTone, Panel, runTone } from './primitives.js';

/**
 * Two runs, side by side.
 *
 * This is the question the playground exists to answer and the one a single run
 * cannot: hold everything constant, swap one participant, and see what changes.
 * "Our credential verifies here and not there" is only actionable once you can
 * point at the specific check that differs.
 */
export function Compare({ runs }: { runs: RunListItem[] }) {
  const [leftId, setLeftId] = useState<string>(runs[1]?.id ?? '');
  const [rightId, setRightId] = useState<string>(runs[0]?.id ?? '');

  const left = runs.find((run) => run.id === leftId);
  const right = runs.find((run) => run.id === rightId);

  const diff = useMemo(() => (left && right ? diffChecks(left, right) : undefined), [left, right]);

  if (runs.length < 2) {
    return (
      <Panel title="Compare runs">
        <p className="p-4 text-sm text-muted">
          Two recorded runs are needed to compare. Run a scenario, change one participant, and run it again.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-3 pb-2">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RunPicker label="Baseline" runs={runs} value={leftId} onChange={setLeftId} />
        <RunPicker label="Compared with" runs={runs} value={rightId} onChange={setRightId} />
      </div>

      {left && right && diff && (
        <>
          <Panel title="What differs in the configuration" subtitle="Everything else is held constant">
            <ConfigDiff left={left} right={right} />
          </Panel>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Panel
              title="Checks that disagree"
              subtitle={`${diff.changed.length} assertion(s) resolved differently`}
              className="h-full"
            >
              {diff.changed.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  Every assertion that ran in both resolved the same way. If the outcomes still differ, the cause is
                  in the checks that only one side ran — shown opposite.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {diff.changed.map((entry) => (
                    <li key={entry.id} className="px-3 py-2.5">
                      <div className="text-sm font-medium leading-snug text-ink">{entry.title}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge tone={checkTone(entry.left.status, entry.left.expected)} glyph>
                          baseline: {entry.left.status}
                        </Badge>
                        <span className="text-muted">→</span>
                        <Badge tone={checkTone(entry.right.status, entry.right.expected)} glyph>
                          compared: {entry.right.status}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-xs leading-snug text-muted">{entry.right.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Checks only one side ran"
              subtitle="Usually the more revealing half"
              className="h-full"
            >
              {diff.onlyLeft.length === 0 && diff.onlyRight.length === 0 ? (
                <p className="p-4 text-sm text-muted">Both runs evaluated the same set of assertions.</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {diff.onlyLeft.map((check) => (
                    <li key={`l-${check.id}`} className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <Badge>baseline only</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-snug text-ink">{check.title}</div>
                          <div className="text-2xs text-muted">{check.spec}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                  {diff.onlyRight.map((check) => (
                    <li key={`r-${check.id}`} className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <Badge tone="accent">compared only</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm leading-snug text-ink">{check.title}</div>
                          <div className="text-2xs text-muted">{check.spec}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function RunPicker({
  label,
  runs,
  value,
  onChange,
}: {
  label: string;
  runs: RunListItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = runs.find((run) => run.id === value);
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <label className="block">
        <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.participants.issuer.label} → {run.participants.verifier.label} · {run.config.format} ·{' '}
              {run.config.tamper} · {new Date(run.startedAt).toLocaleTimeString()}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={runTone(selected.status)} glyph>
            {selected.status}
          </Badge>
          <span className="text-xs text-muted">
            {selected.summary?.checksPassed ?? 0} passed · {selected.summary?.checksFailed ?? 0} failed ·{' '}
            {selected.summary?.checksWarned ?? 0} warned
          </span>
        </div>
      )}
    </div>
  );
}

/** Shows only the configuration fields that actually differ. */
function ConfigDiff({ left, right }: { left: RunListItem; right: RunListItem }) {
  const rows: Array<{ field: string; left: string; right: string }> = [
    { field: 'Issuer', left: left.participants.issuer.label, right: right.participants.issuer.label },
    { field: 'Wallet', left: left.participants.wallet.label, right: right.participants.wallet.label },
    { field: 'Verifier', left: left.participants.verifier.label, right: right.participants.verifier.label },
    { field: 'Format', left: left.config.format, right: right.config.format },
    { field: 'Proof suite', left: left.config.proofType, right: right.config.proofType },
    { field: 'OpenID4VCI revision', left: left.config.vciDraft ?? 'draft-13', right: right.config.vciDraft ?? 'draft-13' },
    { field: 'Flow', left: left.config.flowMode ?? 'cross-device', right: right.config.flowMode ?? 'cross-device' },
    { field: 'Fault', left: left.config.tamper, right: right.config.tamper },
  ].filter((row) => row.left !== row.right);

  if (rows.length === 0) {
    return (
      <p className="p-3 text-sm text-muted">
        These runs used an identical configuration. Any difference in outcome is non-deterministic — a timeout, or
        state left behind by an earlier run.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">Configuration fields that differ between the two runs, left then right.</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field} className="border-b border-line/40 last:border-0">
            <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">
              {row.field}
            </th>
            <td className="px-3 py-1.5 text-ink">{row.left}</td>
            <td aria-hidden="true" className="px-2 py-1.5 text-muted">
              →
            </td>
            <td className="px-3 py-1.5 text-accent">{row.right}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface CheckDiff {
  changed: Array<{ id: string; title: string; left: ConformanceCheck; right: ConformanceCheck }>;
  onlyLeft: ConformanceCheck[];
  onlyRight: ConformanceCheck[];
}

/**
 * Diffs two runs' checks by assertion id.
 *
 * A check missing from one side is as interesting as one that resolved
 * differently — it usually means that run never got far enough to ask, which is
 * the more useful thing to know.
 */
function diffChecks(left: RunListItem, right: RunListItem): CheckDiff {
  const index = (run: RunListItem) => new Map(run.checks.map((check) => [check.id, check]));
  const leftChecks = index(left);
  const rightChecks = index(right);

  const changed: CheckDiff['changed'] = [];
  for (const [id, leftCheck] of leftChecks) {
    const rightCheck = rightChecks.get(id);
    if (rightCheck && rightCheck.status !== leftCheck.status) {
      changed.push({ id, title: leftCheck.title, left: leftCheck, right: rightCheck });
    }
  }

  return {
    changed,
    onlyLeft: [...leftChecks.values()].filter((check) => !rightChecks.has(check.id)),
    onlyRight: [...rightChecks.values()].filter((check) => !leftChecks.has(check.id)),
  };
}
