import type { StepId, StepStatus } from '@interop/shared';
import { STEP_LABELS } from '@interop/shared';
import { Badge, stepTone } from './primitives.js';

const ORDER: StepId[] = ['discover', 'offer', 'issue', 'present', 'verify'];

const GLYPH: Record<StepStatus, string> = {
  pending: '○',
  running: '◐',
  passed: '●',
  failed: '✕',
  skipped: '–',
  'awaiting-user': '◔',
};

export function Timeline({
  steps,
  exchangeCounts,
}: {
  steps: Record<StepId, StepStatus>;
  exchangeCounts: Record<string, number>;
}) {
  return (
    <ol className="flex flex-col gap-0 p-2 sm:flex-row sm:items-stretch">
      {ORDER.map((step, index) => {
        const status = steps[step];
        const tone = stepTone(status);
        return (
          <li key={step} className="flex flex-1 items-center gap-2">
            <div
              className={`flex flex-1 items-center gap-2.5 rounded-md border px-2.5 py-2 ${
                status === 'running' || status === 'awaiting-user'
                  ? 'border-accent/50 bg-accent/5'
                  : 'border-line bg-surface-2'
              }`}
            >
              <span
                aria-hidden
                className={`text-[15px] leading-none ${
                  tone === 'pass'
                    ? 'text-pass'
                    : tone === 'fail'
                      ? 'text-fail'
                      : tone === 'warn'
                        ? 'text-warn'
                        : tone === 'accent'
                          ? 'animate-pulse text-accent'
                          : 'text-muted'
                }`}
              >
                {GLYPH[status]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-medium text-ink">{STEP_LABELS[step]}</div>
                <div className="text-[10px] text-muted">
                  {status === 'pending' ? 'not started' : status.replace('-', ' ')}
                  {exchangeCounts[step] ? ` · ${exchangeCounts[step]} exchange(s)` : ''}
                </div>
              </div>
              {status === 'awaiting-user' && <Badge tone="warn">action</Badge>}
            </div>
            {index < ORDER.length - 1 && (
              <span aria-hidden className="hidden shrink-0 text-muted sm:block">
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
