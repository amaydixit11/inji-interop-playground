import type { ReactNode } from 'react';
import type { CheckStatus, ParticipantKind, RunStatus, StepStatus, Traceability } from '@interop/shared';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-line bg-surface ${className}`}>
      {title && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
            {subtitle && <p className="truncate text-[11px] text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'pass' | 'fail' | 'warn' | 'info' | 'accent';
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line bg-surface-2 text-muted',
    pass: 'border-pass/40 bg-pass/10 text-pass',
    fail: 'border-fail/40 bg-fail/10 text-fail',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    info: 'border-info/40 bg-info/10 text-info',
    accent: 'border-accent/40 bg-accent/10 text-accent',
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function checkTone(status: CheckStatus, expected?: boolean): 'pass' | 'fail' | 'warn' | 'neutral' | 'info' {
  if (status === 'fail') return expected ? 'info' : 'fail';
  if (status === 'pass') return 'pass';
  if (status === 'warn') return 'warn';
  return 'neutral';
}

export function runTone(status: RunStatus): 'pass' | 'fail' | 'warn' | 'accent' | 'neutral' {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'awaiting-user':
      return 'warn';
    case 'running':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function stepTone(status: StepStatus): 'pass' | 'fail' | 'warn' | 'accent' | 'neutral' {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'awaiting-user':
      return 'warn';
    case 'running':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function kindTone(kind: ParticipantKind): 'accent' | 'info' | 'neutral' {
  if (kind === 'inji') return 'accent';
  if (kind === 'external') return 'info';
  return 'neutral';
}

export function TraceabilityBadge({ traceability }: { traceability: Traceability }) {
  return traceability === 'full' ? (
    <Badge tone="pass" title="Every protocol exchange is captured by the playground.">
      fully traced
    </Badge>
  ) : (
    <Badge
      tone="warn"
      title="This participant talks to the other endpoints directly, so its payloads are not captured. Results are correspondingly weaker evidence."
    >
      endpoint only
    </Badge>
  );
}

/** Pretty-prints a payload, falling back to raw text when it is not JSON. */
export function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}
