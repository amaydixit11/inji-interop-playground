import { useState } from 'react';
import type { ConformanceCheck } from '@interop/shared';
import { STEP_LABELS } from '@interop/shared';
import { Badge, checkTone, Panel } from './primitives.js';

/**
 * The interoperability findings for a run.
 *
 * Each entry names the clause it is asserting and who is answerable for a
 * failure, so a red line here can be taken to the team that owns that side of
 * the exchange without further investigation.
 */
export function ChecksPanel({ checks }: { checks: ConformanceCheck[] }) {
  const [onlyProblems, setOnlyProblems] = useState(false);

  const visible = onlyProblems ? checks.filter((check) => check.status !== 'pass') : checks;
  const counts = {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail' && !c.expected).length,
    expected: checks.filter((c) => c.status === 'fail' && c.expected).length,
    warn: checks.filter((c) => c.status === 'warn').length,
  };

  return (
    <Panel
      title="Conformance checks"
      subtitle="Assertions evaluated against the observed payloads"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <Badge tone="pass">{counts.pass} pass</Badge>
            {counts.fail > 0 && <Badge tone="fail">{counts.fail} fail</Badge>}
            {counts.expected > 0 && <Badge tone="info">{counts.expected} expected</Badge>}
            {counts.warn > 0 && <Badge tone="warn">{counts.warn} warn</Badge>}
          </div>
          <button
            type="button"
            onClick={() => setOnlyProblems((value) => !value)}
            className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
              onlyProblems ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'
            }`}
          >
            problems only
          </button>
        </div>
      }
      className="h-full"
    >
      {visible.length === 0 && (
        <p className="p-4 text-[11.5px] text-muted">
          {checks.length === 0 ? 'Checks appear here as the run progresses.' : 'No problems found.'}
        </p>
      )}
      <ul className="divide-y divide-line/60">
        {visible.map((check, index) => (
          <li key={`${check.id}-${index}`} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5">
                <Badge tone={checkTone(check.status, check.expected)}>
                  {check.expected && check.status === 'fail' ? 'expected' : check.status}
                </Badge>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium leading-snug text-ink">{check.title}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{check.detail}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5">{check.spec}</span>
                  <span>{STEP_LABELS[check.step]}</span>
                  {check.attributedTo && (
                    <span className="text-fail">attributed to the {check.attributedTo}</span>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
