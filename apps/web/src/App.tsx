import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Participant, RunConfig, RunRecord, Scenario } from '@interop/shared';
import { api } from './api.js';
import { download, runReport } from './report.js';
import { useBatch } from './hooks/useBatch.js';
import { useRun } from './hooks/useRun.js';
import { ChecksPanel } from './components/ChecksPanel.js';
import { Compare } from './components/Compare.js';
import { Dashboard } from './components/Dashboard.js';
import { HistoryMatrix, toMarkdown } from './components/HistoryMatrix.js';
import { ProtocolInspector } from './components/ProtocolInspector.js';
import { RunBuilder } from './components/RunBuilder.js';
import { Scenarios } from './components/Scenarios.js';
import { SequenceDiagram } from './components/SequenceDiagram.js';
import { Timeline } from './components/Timeline.js';
import { UserActionPrompt } from './components/UserActionPrompt.js';
import { Badge, runTone } from './components/primitives.js';

const DEFAULT_CONFIG: RunConfig = {
  issuerId: 'reference-issuer',
  walletId: 'reference-wallet',
  verifierId: 'reference-verifier',
  format: 'ldp_vc',
  proofType: 'Ed25519Signature2020',
  walletProofType: 'jwt',
  tamper: 'none',
};

type View = 'live' | 'sequence' | 'dashboard' | 'compare' | 'history';

export function App() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [publicUrl, setPublicUrl] = useState('');
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [view, setView] = useState<View>('live');
  const [loadError, setLoadError] = useState<string>();
  // On by default: the playground's first job is explaining the protocols, and
  // somebody who already knows them can turn it off in one click.
  const [explain, setExplain] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState<Scenario>();

  const { run, connected, start, completeAction, abort, error } = useRun();
  const refreshHistoryRef = useRef<() => void>(() => undefined);
  const batch = useBatch(() => refreshHistoryRef.current());
  const busy = run?.status === 'running' || run?.status === 'awaiting-user' || batch.running;

  useEffect(() => {
    api
      .participants()
      .then((result) => {
        setParticipants(result.participants);
        setPublicUrl(result.publicUrl);
      })
      .catch((caught: Error) => setLoadError(caught.message));
  }, []);

  const refreshHistory = useCallback(() => {
    api.runs().then((result) => setHistory(result.runs)).catch(() => undefined);
  }, []);

  useEffect(refreshHistory, [refreshHistory]);
  refreshHistoryRef.current = refreshHistory;

  // The completed record is only written once the run finishes, so the matrix
  // is refreshed on that transition rather than polled.
  useEffect(() => {
    if (run && (run.status === 'passed' || run.status === 'failed' || run.status === 'aborted')) {
      refreshHistory();
    }
  }, [run?.status, refreshHistory, run]);

  const exchangeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const exchange of run?.exchanges ?? []) {
      counts[exchange.step] = (counts[exchange.step] ?? 0) + 1;
    }
    return counts;
  }, [run?.exchanges]);

  /** Exports the run currently on screen, fetching the persisted record. */
  const exportRun = useCallback(async () => {
    if (!run) return;
    try {
      const record = await api.run(run.id);
      download(`inji-run-${record.id.slice(0, 8)}.md`, runReport(record));
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [run]);

  const exportMarkdown = useCallback(() => {
    const blob = new Blob([toMarkdown(history)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inji-interop-report-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [history]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <div className="mr-auto">
          <h1 className="text-[14px] font-semibold tracking-tight text-ink">
            Inji Interoperability Playground
          </h1>
          <p className="text-[11px] text-muted">
            Issue, hold, present and verify credentials across implementations — and inspect every exchange.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={connected ? 'pass' : 'fail'}>{connected ? 'live' : 'disconnected'}</Badge>
          {publicUrl && (
            <span
              className="payload hidden text-muted lg:inline"
              title="Public URL used for DIDs and QR payloads. A localhost value cannot be reached from a phone."
            >
              {publicUrl}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExplain((value) => !value)}
          title="Annotate each step and payload with what it is and why the protocol has it"
          className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
            explain ? 'border-info/50 bg-info/10 text-info' : 'border-line text-muted hover:text-ink'
          }`}
        >
          Explain
        </button>

        <nav className="flex gap-1 rounded-md border border-line bg-surface-2 p-0.5">
          {(['live', 'sequence', 'dashboard', 'compare', 'history'] as View[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                view === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {value}
            </button>
          ))}
        </nav>
      </header>

      {(loadError || error) && (
        <div className="shrink-0 border-b border-fail/40 bg-fail/10 px-4 py-2 text-[11.5px] text-fail">
          {loadError ?? error}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto p-3">
        {view === 'dashboard' ? (
          <Dashboard runs={history} />
        ) : view === 'compare' ? (
          <Compare runs={history} />
        ) : view === 'history' ? (
          <div className="h-full">
            <HistoryMatrix
              runs={history}
              onSelect={(record) => {
                setConfig(record.config);
                setView('live');
              }}
              onExport={exportMarkdown}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <Scenarios
              participants={participants}
              batch={batch.entries}
              batchRunning={batch.running}
              onRunAll={() => void batch.start()}
              onCancelAll={batch.cancel}
              disabled={busy}
              onRun={(scenarioConfig, scenario) => {
                setConfig(scenarioConfig);
                setActiveScenario(scenario);
                void start(scenarioConfig);
              }}
            />

            <details
              open={builderOpen}
              onToggle={(event) => setBuilderOpen((event.currentTarget as HTMLDetailsElement).open)}
              className="rounded-lg border border-line bg-surface"
            >
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink hover:text-accent">
                Configure a run yourself
                <span className="ml-2 text-[11px] font-normal text-muted">
                  {config.issuerId} → {config.walletId} → {config.verifierId} · {config.format}
                </span>
              </summary>
              <div className="border-t border-line p-3">
                <RunBuilder participants={participants} config={config} onChange={setConfig} disabled={busy} />
              </div>
            </details>

            <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <button
                type="button"
                disabled={busy || participants.length === 0}
                onClick={() => {
                  setActiveScenario(undefined);
                  void start(config);
                }}
                className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Run in progress…' : 'Run interoperability test'}
              </button>

              {activeScenario && (
                <span className="text-[11px] text-info" title={activeScenario.expect}>
                  {activeScenario.title}
                </span>
              )}

              {run && (
                <>
                  <Badge tone={runTone(run.status)}>{run.status}</Badge>
                  {run.summary && (
                    <span className="text-[11px] text-muted">
                      {run.summary.checksPassed} passed · {run.summary.checksFailed} failed ·{' '}
                      {run.summary.checksWarned} warned
                      {run.summary.checksExpectedFailures > 0 &&
                        ` · ${run.summary.checksExpectedFailures} expected failure(s)`}
                      {` · ${run.summary.durationMs}ms`}
                    </span>
                  )}
                  {run.summary?.failure && (
                    <span className="text-[11px] text-fail">{run.summary.failure.message}</span>
                  )}
                  {activeScenario && run.status === 'failed' && activeScenario.expect.startsWith('Fails') && (
                    <span className="text-[11px] text-info">
                      This scenario is expected to fail — the findings are the result.
                    </span>
                  )}
                  {(run.status === 'passed' || run.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => void exportRun()}
                      className="ml-auto rounded border border-line px-2 py-0.5 text-[10.5px] text-muted transition hover:border-accent hover:text-accent"
                    >
                      export this run
                    </button>
                  )}
                </>
              )}
            </div>

            {run && (
              <div className="shrink-0 rounded-lg border border-line bg-surface">
                <Timeline steps={run.steps} exchangeCounts={exchangeCounts} explain={explain} />
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              {view === 'sequence' ? (
                <SequenceDiagram exchanges={run?.exchanges ?? []} />
              ) : (
                <ProtocolInspector
                  exchanges={run?.exchanges ?? []}
                  artifacts={run?.artifacts ?? []}
                  explain={explain}
                />
              )}
              <ChecksPanel checks={run?.checks ?? []} />
            </div>
          </div>
        )}
      </main>

      {run?.pendingAction && (
        <UserActionPrompt
          action={run.pendingAction}
          onComplete={() => void completeAction()}
          onAbort={() => void abort()}
        />
      )}
    </div>
  );
}
