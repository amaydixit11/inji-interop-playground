import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import type { HttpExchange } from '@interop/shared';
import { Panel } from './primitives.js';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
  themeVariables: {
    background: '#0b0f14',
    primaryColor: '#182029',
    primaryTextColor: '#e6edf3',
    primaryBorderColor: '#263140',
    lineColor: '#4da3ff',
    actorBkg: '#182029',
    actorBorder: '#263140',
    actorTextColor: '#e6edf3',
    signalColor: '#8b9bb0',
    signalTextColor: '#e6edf3',
    noteBkgColor: '#1d252f',
    noteTextColor: '#8b9bb0',
  },
});

/** Renders the captured exchanges as a live OpenID4VCI/OpenID4VP sequence. */
export function SequenceDiagram({ exchanges }: { exchanges: HttpExchange[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  const definition = useMemo(() => buildDefinition(exchanges), [exchanges]);

  useEffect(() => {
    if (!containerRef.current || exchanges.length === 0) return;
    let active = true;

    // A unique id per render: mermaid caches by id and would otherwise reuse
    // the previous diagram when the definition changes.
    const id = `sequence-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, definition)
      .then(({ svg }) => {
        if (!active || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setError(undefined);
      })
      .catch((caught: Error) => active && setError(caught.message));

    return () => {
      active = false;
    };
  }, [definition, exchanges.length]);

  return (
    <Panel title="Protocol sequence" subtitle="Rendered from the exchanges actually observed" className="h-full">
      {exchanges.length === 0 ? (
        <p className="p-4 text-xs text-muted">The sequence is drawn as messages are captured.</p>
      ) : error ? (
        <p className="p-4 text-xs text-fail">Could not render the diagram: {error}</p>
      ) : (
        <div ref={containerRef} className="flex min-h-full items-start justify-center overflow-auto p-3" />
      )}
    </Panel>
  );
}

function buildDefinition(exchanges: HttpExchange[]): string {
  const participants = new Map<string, string>();
  const alias = (name: string) => {
    if (!participants.has(name)) participants.set(name, `P${participants.size}`);
    return participants.get(name) as string;
  };

  // Aliases are assigned in first-appearance order so the columns read
  // left-to-right in the order the protocol actually visits them.
  const lines: string[] = [];
  for (const exchange of exchanges) {
    const from = alias(exchange.from);
    const to = alias(exchange.to);
    const label = sanitise(exchange.label);

    if (exchange.error) {
      lines.push(`  ${from}-->>${to}: ${label}`);
      lines.push(`  Note over ${from},${to}: not captured`);
      continue;
    }

    lines.push(`  ${from}->>${to}: ${label}`);
    const status = exchange.status ?? 0;
    lines.push(`  ${to}--)${from}: ${status} ${status >= 400 ? '✗' : '✓'}`);
  }

  const header = [...participants.entries()].map(([name, id]) => `  participant ${id} as ${sanitise(name)}`);
  return ['sequenceDiagram', '  autonumber', ...header, ...lines].join('\n');
}

/** Mermaid treats several characters as syntax; strip them from free text. */
function sanitise(value: string): string {
  return value.replace(/[;:#<>()"']/g, '').slice(0, 60);
}
