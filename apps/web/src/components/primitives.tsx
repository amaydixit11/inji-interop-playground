import type { ReactNode } from 'react';
import type { CheckStatus, ParticipantKind, RunStatus, StepStatus, Traceability } from '@interop/shared';

export type Tone = 'neutral' | 'pass' | 'fail' | 'warn' | 'info' | 'accent';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  headingLevel = 2,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Panels nested inside another titled section need to keep the outline sane. */
  headingLevel?: 2 | 3;
}) {
  const Heading = (headingLevel === 3 ? 'h3' : 'h2') as 'h2' | 'h3';
  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border border-line bg-surface shadow-card ${className}`}
    >
      {title && (
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <Heading className="text-sm font-semibold tracking-tight text-ink">{title}</Heading>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-2',
  pass: 'border-pass/35 bg-pass/10 text-pass',
  fail: 'border-fail/45 bg-fail/12 text-fail',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  info: 'border-info/40 bg-info/12 text-info',
  accent: 'border-accent/40 bg-accent/12 text-accent',
};

/* A glyph per tone, so status never rests on hue alone. The palette is
   CVD-separated (see index.css) but red/green is red/green: somebody with
   deuteranopia should be able to read this with the colour switched off. */
const TONE_GLYPHS: Record<Tone, string> = {
  neutral: '·',
  pass: '✓',
  fail: '✕',
  warn: '!',
  info: '◆',
  accent: '◇',
};

/**
 * The status glyph. `label` is the word behind the shape, announced to a
 * screen reader and never rendered — callers that show the word themselves
 * pass `labelled` so it is not read out twice.
 */
export function StatusIcon({
  tone,
  label,
  labelled = false,
  className = '',
}: {
  tone: Tone;
  label: string;
  labelled?: boolean;
  className?: string;
}) {
  const colours: Record<Tone, string> = {
    neutral: 'text-muted',
    pass: 'text-pass',
    fail: 'text-fail',
    warn: 'text-warn',
    info: 'text-info',
    accent: 'text-accent',
  };
  return (
    <span className={`inline-flex shrink-0 items-center ${colours[tone]} ${className}`}>
      <span aria-hidden="true" className="font-semibold leading-none">
        {TONE_GLYPHS[tone]}
      </span>
      {!labelled && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
  glyph = false,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
  /** Adds the tone's glyph, for badges whose text does not already say the status. */
  glyph?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider ${TONE_CLASSES[tone]}`}
    >
      {glyph && (
        <span aria-hidden="true" className="leading-none">
          {TONE_GLYPHS[tone]}
        </span>
      )}
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
    <Badge tone="pass" glyph title="Every protocol exchange is captured by the playground.">
      fully traced
    </Badge>
  ) : (
    <Badge
      tone="warn"
      glyph
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
