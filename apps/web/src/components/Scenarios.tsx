import type { Participant, RunConfig, Scenario, ScenarioTrack } from '@interop/shared';
import { SCENARIOS, SCENARIO_TRACKS, scenarioConfig } from '@interop/shared';
import type { BatchEntry } from '../hooks/useBatch.js';
import { Badge, StatusIcon } from './primitives.js';

/**
 * One-click entry points.
 *
 * Nine participants across seven dimensions is a lot to face with no idea which
 * combination is worth trying. Each card states the question it answers and
 * what will happen — including the ones that fail, which are labelled as such
 * rather than presented as surprises. A demo should be able to start here and
 * never touch a dropdown.
 */
export function Scenarios({
  participants,
  onRun,
  onRunAll,
  onCancelAll,
  batch,
  batchRunning,
  disabled,
  open,
  onOpenChange,
}: {
  participants: Participant[];
  onRun: (config: RunConfig, scenario: Scenario) => void;
  onRunAll: () => void;
  onCancelAll: () => void;
  batch: BatchEntry[];
  batchRunning: boolean;
  disabled: boolean;
  /** Collapsed once a run starts, so the result is not pushed below the fold. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const available = new Set(participants.map((participant) => participant.id));
  const byId = new Map(batch.map((entry) => [entry.scenario.id, entry]));

  return (
    <section aria-labelledby="scenarios-heading" className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className={`flex flex-wrap items-end justify-between gap-3 ${open ? 'mb-4' : ''}`}>
        <div className="measure">
          <h2 id="scenarios-heading" className="text-lg font-semibold tracking-tight text-ink">
            Start here
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {open
              ? 'Each of these answers one question about the stack. Pick one, or configure a run yourself below.'
              : 'Collapsed so the run below stays in view.'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-controls="scenario-tracks"
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink"
          >
            <span aria-hidden="true" className="mr-1">
              {open ? '▾' : '▸'}
            </span>
            {open ? 'Hide' : 'Show'} {SCENARIOS.length} scenarios
          </button>
          <button
            type="button"
            onClick={batchRunning ? onCancelAll : onRunAll}
            disabled={disabled && !batchRunning}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              batchRunning
                ? 'border-warn/50 bg-warn/10 text-warn hover:bg-warn/20'
                : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
            }`}
          >
            {batchRunning ? 'Stop the batch' : 'Run all'}
          </button>
        </div>
      </div>

      {batch.length > 0 && open && <BatchProgress entries={batch} />}

      <div id="scenario-tracks" hidden={!open} className="flex flex-col gap-5">
        {SCENARIO_TRACKS.map((track) => {
          const scenarios = SCENARIOS.filter((scenario) => scenario.track === track.id).sort(
            (a, b) => a.order - b.order,
          );
          if (scenarios.length === 0) return null;
          return (
            <section key={track.id} aria-labelledby={`track-${track.id}`}>
              <div className="mb-2.5 border-b border-line pb-2">
                <h3 id={`track-${track.id}`} className="text-base font-semibold tracking-tight text-ink">
                  {track.title}
                </h3>
                <p className="mt-0.5 max-w-[92ch] text-xs leading-relaxed text-muted">{track.blurb}</p>
              </div>
              <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {scenarios.map((scenario) => (
                  <ScenarioCard
                    key={scenario.id}
                    scenario={scenario}
                    available={available}
                    outcome={byId.get(scenario.id)}
                    disabled={disabled}
                    onRun={onRun}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ScenarioCard({
  scenario,
  available,
  outcome,
  disabled,
  onRun,
}: {
  scenario: Scenario;
  available: Set<string>;
  outcome?: BatchEntry;
  disabled: boolean;
  onRun: (config: RunConfig, scenario: Scenario) => void;
}) {
  // A scenario naming a participant that is not registered cannot run; saying
  // so on the card beats a preflight failure.
  const missing = scenario.requires.filter((id) => !available.has(id));
  const blocked = missing.length > 0;
  const expectsFailure = scenario.expect.startsWith('Fails');
  const detailId = `scenario-${scenario.id}-detail`;

  const status = outcome && outcome.status !== 'pending' ? outcome.status : undefined;
  const statusTone =
    status === 'running' ? 'accent'
    : status === 'skipped' ? 'neutral'
    : status === 'passed' ? 'pass'
    : status ? 'fail'
    : undefined;

  return (
    <li className="contents">
      <button
        type="button"
        disabled={disabled || blocked}
        onClick={() => onRun(scenarioConfig(scenario), scenario)}
        aria-label={scenario.title}
        aria-describedby={detailId}
        className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface-2 p-3.5 text-left transition hover:-translate-y-px hover:border-accent/60 hover:bg-surface-3 hover:shadow-lift focus-visible:border-accent/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {/* A hairline that lights up on hover, so the card has an edge to catch. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-accent/0 transition-colors group-hover:bg-accent/50"
        />

        <div className="flex items-start gap-2">
          <h4 className="min-w-0 flex-1 text-base font-medium leading-snug text-ink">{scenario.title}</h4>
          {statusTone && status ? (
            <Badge tone={statusTone} glyph>
              {status}
            </Badge>
          ) : expectsFailure ? (
            <Badge tone="warn" glyph title="This run is expected to fail — the findings are the result.">
              finds bugs
            </Badge>
          ) : scenario.duration === 'needs-a-phone' ? (
            <Badge tone="warn" glyph>
              needs a phone
            </Badge>
          ) : null}
        </div>

        <div id={detailId}>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{scenario.question}</p>
          <p className="mt-2.5 border-t border-line/60 pt-2.5 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-ink-2">Expect: </span>
            {scenario.expect}
          </p>

          {blocked && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
              <StatusIcon tone="warn" label="Cannot run" />
              <span>Needs {missing.join(', ')} — start the Inji stack to enable this.</span>
            </p>
          )}
          {outcome?.detail && (
            <p
              className={`mt-2 flex items-start gap-1.5 text-xs leading-relaxed ${
                outcome.detail.startsWith('Not what') ? 'text-fail' : 'text-muted'
              }`}
            >
              {outcome.detail.startsWith('Not what') && <StatusIcon tone="fail" label="Unexpected outcome" />}
              <span>{outcome.detail}</span>
            </p>
          )}
        </div>

        {!blocked && !outcome && (
          <span
            aria-hidden="true"
            className="mt-2.5 text-xs font-medium text-accent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            Run this →
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Progress across a batch.
 *
 * Counts "as expected" rather than "passed", because several of these scenarios
 * are supposed to fail. A batch where everything passes would mean the runs
 * that find real defects had stopped finding them.
 */
function BatchProgress({ entries }: { entries: BatchEntry[] }) {
  const done = entries.filter((entry) => entry.status !== 'pending' && entry.status !== 'running').length;
  const surprises = entries.filter((entry) => entry.detail?.startsWith('Not what')).length;
  const percent = entries.length === 0 ? 0 : Math.round((done / entries.length) * 100);

  return (
    <div className="mb-4 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {done} of {entries.length} scenarios
        </span>
        <span className={`flex items-center gap-1.5 text-xs ${surprises > 0 ? 'text-fail' : 'text-muted'}`}>
          {surprises > 0 && <StatusIcon tone="fail" label="Unexpected" labelled />}
          {surprises > 0
            ? `${surprises} did not match what the scenario expected`
            : done === entries.length
              ? 'All outcomes were as expected'
              : 'Running…'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Batch progress"
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
