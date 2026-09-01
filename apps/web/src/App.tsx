import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Participant, RunConfig, RunRecord } from '@interop/shared';
import { api } from './api.js';
import { useRun } from './hooks/useRun.js';
import { ChecksPanel } from './components/ChecksPanel.js';
import { Dashboard } from './components/Dashboard.js';
import { HistoryMatrix, toMarkdown } from './components/HistoryMatrix.js';
import { ProtocolInspector } from './components/ProtocolInspector.js';
import { RunBuilder } from './components/RunBuilder.js';
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

type View = 'live' | 'sequence' | 'history' | 'dashboard';

export function App() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [publicUrl, setPublicUrl] = useState('');
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [view, setView] = useState<View>('live');
  const [loadError, setLoadError] = useState<string>();

  const { run, connected, start, completeAction, abort, error } = useRun();
  const busy = run?.status === 'running' || run?.status === 'awaiting-user';

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

        <nav className="flex gap-1 rounded-md border border-line bg-surface-2 p-0.5">
          {(['live', 'sequence', 'dashboard', 'history'] as View[]).map((value) => (
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
            <RunBuilder participants={participants} config={config} onChange={setConfig} disabled={busy} />

            <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <button
                type="button"
                disabled={busy || participants.length === 0}
                onClick={() => void start(config)}
                className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-canvas transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Run in progress…' : 'Run interoperability test'}
              </button>

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
                </>
              )}
            </div>

            {run && (
              <div className="shrink-0 rounded-lg border border-line bg-surface">
                <Timeline steps={run.steps} exchangeCounts={exchangeCounts} />
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              {view === 'sequence' ? (
                <SequenceDiagram exchanges={run?.exchanges ?? []} />
              ) : (
                <ProtocolInspector exchanges={run?.exchanges ?? []} artifacts={run?.artifacts ?? []} />
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
