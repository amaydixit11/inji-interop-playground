import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Participant, RunConfig, RunListItem, RunRecord, Scenario } from '@interop/shared';
import { api } from './api.js';
import { download, runReport } from './report.js';
import { useBatch } from './hooks/useBatch.js';
import { useRun, type LiveRun } from './hooks/useRun.js';
import { ChecksPanel } from './components/ChecksPanel.js';
import { Compare } from './components/Compare.js';
import { Dashboard } from './components/Dashboard.js';
import { OfficialSdk } from './components/OfficialSdk.js';
import { HistoryMatrix, toMarkdown } from './components/HistoryMatrix.js';
import { ProtocolInspector } from './components/ProtocolInspector.js';
import { RunBuilder } from './components/RunBuilder.js';
import { blockers, Scenarios, unavailableParticipants } from './components/Scenarios.js';
import { SequenceDiagram } from './components/SequenceDiagram.js';
import { Story } from './components/Story.js';
import { Timeline } from './components/Timeline.js';
import { UserActionPrompt } from './components/UserActionPrompt.js';
import { ViewTabs } from './components/ViewTabs.js';
import type { View } from './components/ViewTabs.js';
import { Badge, StatusIcon, runTone } from './components/primitives.js';

const DEFAULT_CONFIG: RunConfig = {
  issuerId: 'reference-issuer',
  walletId: 'reference-wallet',
  verifierId: 'reference-verifier',
  format: 'ldp_vc',
  proofType: 'Ed25519Signature2020',
  walletProofType: 'jwt',
  tamper: 'none',
};

export function App() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [publicUrl, setPublicUrl] = useState('');
  const [config, setConfig] = useState<RunConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<RunListItem[]>([]);
  const [view, setView] = useState<View>('live');
  const [loadError, setLoadError] = useState<string>();
  // On by default: the playground's first job is explaining the protocols, and
  // somebody who already knows them can turn it off in one click.
  const [explain, setExplain] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(true);
  // The scenario grid fills the viewport, so a run started from it would land
  // entirely below the fold. It collapses on the first run and can be reopened.
  const [scenariosOpen, setScenariosOpen] = useState(true);
  const [activeScenario, setActiveScenario] = useState<Scenario>();
  // The run currently being read: the one that just finished, or one opened
  // from the history. Story and the per-run export both work from this, so
  // "the run you are looking at" means the same thing everywhere.
  const [viewedRecord, setViewedRecord] = useState<RunRecord>();

  const { run, connected, start, completeAction, abort, error } = useRun();
  // A run opened from the history takes the live run's place on screen until
  // the next run starts, so past runs get the same inspector and timeline.
  const [openedRun, setOpenedRun] = useState<LiveRun>();
  useEffect(() => setOpenedRun(undefined), [run?.id]);
  const shown = openedRun ?? run;

  // Runs started by "Run all" go through the API rather than the live socket,
  // so nothing sets the viewed record. Story then describes the latest run
  // that has a narrative instead of claiming there is nothing to describe.
  useEffect(() => {
    if (view !== 'story' || viewedRecord?.narrative) return;
    const latest = history.find((item) => item.narrative);
    if (latest) api.run(latest.id).then(setViewedRecord).catch(() => undefined);
  }, [view, viewedRecord, history]);

  /** Opens a saved run in the live view: from History, or a recorded scenario. */
  const openRun = useCallback((id: string) => {
    // The listing carries no payloads, so the full record is fetched before it
    // can fill the inspector.
    void api
      .run(id)
      .then((full) => {
        setConfig(full.config);
        setOpenedRun({ ...full, logs: [] });
        setViewedRecord(full);
        setScenariosOpen(false);
        setBuilderOpen(false);
        setView('live');
      })
      .catch((caught: Error) => setLoadError(caught.message));
  }, []);
  const outputRef = useRef<HTMLDivElement>(null);
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
      // The narrative is built when the run finishes, so it only exists on the
      // persisted record rather than in the live event stream.
      api.run(run.id).then(setViewedRecord).catch(() => undefined);
    }
  }, [run?.status, refreshHistory, run]);

  useEffect(() => {
    if (run?.id) outputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [run?.id]);

  const exchangeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const exchange of shown?.exchanges ?? []) {
      counts[exchange.step] = (counts[exchange.step] ?? 0) + 1;
    }
    return counts;
  }, [shown?.exchanges]);

  /** Exports the run currently on screen, fetching the persisted record. */
  const exportRun = useCallback(async () => {
    const id = shown?.id ?? viewedRecord?.id;
    if (!id) return;
    try {
      const record = await api.run(id);
      download(`inji-run-${record.id.slice(0, 8)}.md`, runReport(record));
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [run, viewedRecord]);

  const exportMarkdown = useCallback(() => {
    const blob = new Blob([toMarkdown(history)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inji-interop-report-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [history]);

  // Announced to a screen reader when a run ends, since the result is otherwise
  // conveyed only by colour and by content appearing further down the page.
  const announcement = useMemo(() => {
    if (!run) return '';
    if (run.status === 'running') return 'Run in progress.';
    if (run.status === 'awaiting-user') return 'Waiting for you to do something.';
    if (!run.summary) return `Run ${run.status}.`;
    const { checksPassed, checksFailed, checksWarned } = run.summary;
    return `Run ${run.status}. ${checksPassed} checks passed, ${checksFailed} failed, ${checksWarned} warned.`;
  }, [run?.status, run?.summary, run]);

  return (
    <div className="flex h-full flex-col">
      <a className="skip-link" href="#view-panel">
        Skip to content
      </a>

      <header className="shrink-0 border-b border-line bg-gradient-to-b from-surface-2 to-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-md font-bold text-accent shadow-[inset_0_0_0_1px_rgb(92_176_255_/_0.3)]"
            >
              ⇄
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-md font-semibold tracking-tight text-ink">
                Inji Interoperability Playground
              </h1>
              <p className="truncate text-xs text-muted">
                Issue, hold, present and verify credentials across implementations — and inspect every exchange.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-semibold uppercase tracking-wider ${
                connected ? 'border-pass/35 bg-pass/10 text-pass' : 'border-fail/45 bg-fail/12 text-fail'
              }`}
            >
              <span aria-hidden="true">{connected ? '●' : '○'}</span>
              {connected ? 'live' : 'disconnected'}
              <span className="sr-only">
                {connected ? 'Connected to the playground backend.' : 'Not connected to the playground backend.'}
              </span>
            </span>
            {publicUrl && (
              <span
                className="payload hidden truncate text-muted lg:inline lg:max-w-[22rem]"
                title="Public URL used for DIDs and QR payloads. A localhost value cannot be reached from a phone."
              >
                {publicUrl}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExplain((value) => !value)}
            aria-pressed={explain}
            title="Annotate each step and payload with what it is and why the protocol has it"
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              explain
                ? 'border-info/50 bg-info/12 text-info'
                : 'border-line text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            Explain
          </button>

          <ViewTabs view={view} onChange={setView} />
          </div>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {(loadError || error) && (
        <div className="shrink-0 border-b border-fail/40 bg-fail/10 px-4 py-2 text-xs text-fail">
          {loadError ?? error}
        </div>
      )}

      <main
        id="view-panel"
        role="tabpanel"
        aria-labelledby={`tab-${view}`}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto p-3 outline-none"
      >
        {view === 'dashboard' ? (
          <Dashboard runs={history} />
        ) : view === 'story' ? (
          viewedRecord?.narrative ? (
            <Story
              narrative={viewedRecord.narrative}
              participants={viewedRecord.participants}
              format={viewedRecord.config.format}
              status={viewedRecord.status}
            />
          ) : (
            <EmptyState
              title="Nothing to describe yet"
              body="Run a scenario, or open a run from History — this view explains what happened without assuming you know the protocols."
            />
          )
        ) : view === 'sdk' ? (
          <OfficialSdk
            verifyServiceUrl={
              participants.find((participant) => participant.id === 'inji-verify')?.config.find((field) => field.key === 'baseUrl')
                ?.value ?? 'http://localhost:8010/v1/verify'
            }
          />
        ) : view === 'compare' ? (
          <Compare runs={history} />
        ) : view === 'history' ? (
          <div className="h-full">
            <HistoryMatrix
              runs={history}
              onSelect={(record) => openRun(record.id)}
              onOpenStory={(record) => {
                // The listing carries no payloads, so the full record is
                // fetched before showing it.
                void api
                  .run(record.id)
                  .then((full) => {
                    setViewedRecord(full);
                    setView('story');
                  })
                  .catch((caught: Error) => setLoadError(caught.message));
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
              onRunAll={() => void batch.start((scenario) => blockers(scenario, unavailableParticipants(participants)))}
              onOpenRecorded={openRun}
              publicUrl={publicUrl}
              onCancelAll={batch.cancel}
              disabled={busy}
              open={scenariosOpen}
              onOpenChange={setScenariosOpen}
              onRun={(scenarioConfig, scenario) => {
                setConfig(scenarioConfig);
                setActiveScenario(scenario);
                setScenariosOpen(false);
                setBuilderOpen(false);
                void start(scenarioConfig);
              }}
            />

            <details
              open={builderOpen}
              onToggle={(event) => setBuilderOpen((event.currentTarget as HTMLDetailsElement).open)}
              className="rounded-xl border border-line bg-surface shadow-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ink transition hover:text-accent">
                <span aria-hidden="true" className="text-muted transition-transform">
                  {builderOpen ? '▾' : '▸'}
                </span>
                Choose issuer, wallet and verifier
                <span className="payload ml-1 truncate text-xs font-normal text-muted">
                  {config.issuerId} → {config.walletId} → {config.verifierId} · {config.format}
                </span>
              </summary>
              <div className="border-t border-line p-3.5">
                <RunBuilder participants={participants} config={config} onChange={setConfig} disabled={busy} />
              </div>
            </details>

            <div
              ref={outputRef}
              className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card"
            >
              <button
                type="button"
                disabled={busy || participants.length === 0}
                onClick={() => {
                  setActiveScenario(undefined);
                  setScenariosOpen(false);
                  setBuilderOpen(false);
                  void start(config);
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-canvas shadow-[0_1px_0_rgb(255_255_255_/_0.2)_inset,0_6px_16px_-8px_rgb(92_176_255_/_0.7)] transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {busy ? 'Run in progress…' : 'Run interoperability test'}
              </button>

              {activeScenario && (
                <span className="text-xs text-info measure" title={activeScenario.expect}>
                  {activeScenario.title}
                </span>
              )}

              {shown && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <StatusIcon tone={runTone(shown.status)} label={shown.status} labelled />
                    <Badge tone={runTone(shown.status)} glyph>{shown.status}</Badge>
                  </span>
                  {shown.summary && (
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                      <Tally tone="pass" count={shown.summary.checksPassed} word="passed" />
                      <Tally tone="fail" count={shown.summary.checksFailed} word="failed" />
                      <Tally tone="warn" count={shown.summary.checksWarned} word="warned" />
                      {shown.summary.checksExpectedFailures > 0 && (
                        <Tally tone="info" count={shown.summary.checksExpectedFailures} word="expected" />
                      )}
                      <span className="text-muted">{shown.summary.durationMs}ms</span>
                    </span>
                  )}
                  {shown.summary?.failure && (
                    <span className="measure text-xs text-fail">{shown.summary.failure.message}</span>
                  )}
                  {activeScenario && shown.status === 'failed' && activeScenario.expected === 'failed' && (
                    <span className="measure text-xs text-info">
                      This scenario is expected to fail — the findings are the result.
                    </span>
                  )}
                  {(shown.status === 'passed' || shown.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => void exportRun()}
                      className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                    >
                      Export this run
                    </button>
                  )}
                </>
              )}
            </div>

            {shown && (
              <div className="shrink-0 rounded-xl border border-line bg-surface shadow-card">
                <Timeline steps={shown.steps} exchangeCounts={exchangeCounts} explain={explain} />
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              {view === 'sequence' ? (
                <SequenceDiagram exchanges={shown?.exchanges ?? []} />
              ) : (
                <ProtocolInspector
                  exchanges={shown?.exchanges ?? []}
                  artifacts={shown?.artifacts ?? []}
                  explain={explain}
                />
              )}
              <ChecksPanel checks={shown?.checks ?? []} />
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

/** A count with its status glyph, so the tally is not colour-coded alone. */
function Tally({ tone, count, word }: { tone: 'pass' | 'fail' | 'warn' | 'info'; count: number; word: string }) {
  const colours = { pass: 'text-pass', fail: 'text-fail', warn: 'text-warn', info: 'text-info' };
  return (
    <span className={`inline-flex items-center gap-1 ${count > 0 ? colours[tone] : 'text-muted'}`}>
      <StatusIcon tone={tone} label={word} labelled />
      <span className="font-semibold tabular-nums">{count}</span>
      <span className="font-normal text-muted">{word}</span>
    </span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line bg-surface/60 p-10 text-center">
      <div className="measure">
        <p className="text-base font-semibold text-ink-2">{title}</p>
        <p className="mt-1.5 text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}
