import { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, HttpExchange } from '@interop/shared';
import { explainExchange, STEP_EXPLANATIONS, STEP_LABELS } from '@interop/shared';
import { Badge, formatPayload, Panel } from './primitives.js';

/**
 * The developer-facing view of a run: every request and response, in order,
 * with the decoded payload of whichever one is selected.
 */
export function ProtocolInspector({
  exchanges,
  artifacts,
  explain,
}: {
  exchanges: HttpExchange[];
  artifacts: Artifact[];
  explain?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<'exchanges' | 'artifacts'>('exchanges');
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);

  // Follow the stream while the user is at the bottom, but stop the moment they
  // scroll up to read something — otherwise inspecting a live run is impossible.
  useEffect(() => {
    const element = listRef.current;
    if (element && pinnedToEnd.current) element.scrollTop = element.scrollHeight;
  }, [exchanges.length]);

  const selected = useMemo(
    () => exchanges.find((exchange) => exchange.id === selectedId) ?? exchanges.at(-1),
    [exchanges, selectedId],
  );

  return (
    <Panel
      title="Protocol inspector"
      subtitle="Raw payloads exchanged at every step"
      actions={
        <div className="flex gap-1 rounded-md border border-line bg-surface-2 p-0.5">
          {(['exchanges', 'artifacts'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded px-2 py-0.5 text-[10.5px] font-medium capitalize transition ${
                tab === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {value} ({value === 'exchanges' ? exchanges.length : artifacts.length})
            </button>
          ))}
        </div>
      }
      className="h-full"
    >
      {tab === 'exchanges' ? (
        <div className="grid h-full grid-rows-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:grid-rows-1">
          <div
            ref={listRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              pinnedToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
            }}
            className="min-h-0 overflow-auto border-b border-line lg:border-b-0 lg:border-r"
          >
            {exchanges.length === 0 && <Empty>Exchanges appear here as the run progresses.</Empty>}
            {exchanges.map((exchange) => {
              const isSelected = selected?.id === exchange.id;
              const failed = exchange.error || (exchange.status ?? 200) >= 400;
              return (
                <button
                  key={exchange.id}
                  type="button"
                  onClick={() => setSelectedId(exchange.id)}
                  className={`block w-full border-b border-line/60 px-3 py-2 text-left transition ${
                    isSelected ? 'bg-accent/10' : 'hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-surface-2 px-1 py-px text-[9.5px] font-semibold text-muted">
                      {exchange.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
                      {exchange.label}
                    </span>
                    {exchange.error ? (
                      <Badge tone="warn">not captured</Badge>
                    ) : (
                      <Badge tone={failed ? 'fail' : 'pass'}>{exchange.status}</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted">
                    {exchange.from} → {exchange.to}
                    {exchange.durationMs !== undefined && ` · ${exchange.durationMs}ms`}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="min-h-0 overflow-auto">
            {selected ? (
              <ExchangeDetail exchange={selected} explain={explain} />
            ) : (
              <Empty>Select an exchange.</Empty>
            )}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-line/60">
          {artifacts.length === 0 && <Empty>Credentials, tokens and results appear here.</Empty>}
          {artifacts.map((artifact) => (
            <details key={artifact.id} className="group">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
                  {artifact.label}
                </span>
                <Badge>{artifact.kind}</Badge>
                <span className="text-[10px] text-muted">{STEP_LABELS[artifact.step]}</span>
              </summary>
              <pre className="payload max-h-96 overflow-auto whitespace-pre-wrap break-all border-t border-line/60 bg-canvas px-3 py-2 text-muted">
                {formatPayload(artifact.value)}
              </pre>
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ExchangeDetail({ exchange, explain }: { exchange: HttpExchange; explain?: boolean }) {
  const explanation = explainExchange(exchange.label);

  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="text-[12px] font-semibold text-ink">{exchange.label}</div>
        <div className="payload mt-1 break-all text-accent">
          {exchange.method} {exchange.url}
        </div>
        <div className="mt-1 text-[10px] text-muted">
          {exchange.from} → {exchange.to} · {STEP_LABELS[exchange.step]}
          {exchange.durationMs !== undefined && ` · ${exchange.durationMs}ms`}
        </div>
      </div>

      {exchange.error && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] leading-snug text-warn">
          {exchange.error}
        </div>
      )}

      {explain && (
        <div className="space-y-1.5 rounded-md border border-info/30 bg-info/5 px-2.5 py-2">
          <p className="text-[11px] leading-snug text-ink">
            {explanation?.what ?? STEP_EXPLANATIONS[exchange.step].what}
          </p>
          <p className="text-[11px] leading-snug text-muted">
            {explanation?.why ?? STEP_EXPLANATIONS[exchange.step].why}
          </p>
          {(explanation?.lookFor ?? STEP_EXPLANATIONS[exchange.step].lookFor) && (
            <p className="text-[11px] leading-snug text-muted">
              <span className="text-info">What to look for: </span>
              {explanation?.lookFor ?? STEP_EXPLANATIONS[exchange.step].lookFor}
            </p>
          )}
        </div>
      )}

      <Section label="Request headers" value={exchange.requestHeaders} />
      {exchange.requestBody !== undefined && <Section label="Request body" value={exchange.requestBody} />}
      {exchange.responseHeaders && <Section label="Response headers" value={exchange.responseHeaders} collapsed />}
      {exchange.responseBody !== undefined && <Section label="Response body" value={exchange.responseBody} />}
    </div>
  );
}

function Section({ label, value, collapsed }: { label: string; value: unknown; collapsed?: boolean }) {
  return (
    <details open={!collapsed}>
      <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink">{label}</summary>
      <pre className="payload mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-canvas px-2.5 py-2 text-muted">
        {formatPayload(value)}
      </pre>
    </details>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-[11.5px] text-muted">{children}</p>;
}
