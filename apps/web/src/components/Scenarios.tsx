import type { Participant, RunConfig, Scenario } from '@interop/shared';
import { SCENARIOS, scenarioConfig } from '@interop/shared';
import type { BatchEntry } from '../hooks/useBatch.js';
import { Badge } from './primitives.js';

/**
 * One-click entry points.
 *
 * Nine participants across six dimensions is a lot to face with no idea which
 * combination is worth trying. Each card states the question it answers and
 * what will happen — including the two that fail, which are labelled as such
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
}: {
  participants: Participant[];
  onRun: (config: RunConfig, scenario: Scenario) => void;
  onRunAll: () => void;
  onCancelAll: () => void;
  batch: BatchEntry[];
  batchRunning: boolean;
  disabled: boolean;
}) {
  const available = new Set(participants.map((participant) => participant.id));
  const byId = new Map(batch.map((entry) => [entry.scenario.id, entry]));

  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Start here</h2>
          <p className="text-[11px] text-muted">
            Each of these answers one question about the stack. Pick one, or configure a run yourself below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-muted">{SCENARIOS.length} scenarios</span>
          <button
            type="button"
            onClick={batchRunning ? onCancelAll : onRunAll}
            disabled={disabled && !batchRunning}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
              batchRunning
                ? 'border-warn/50 bg-warn/10 text-warn'
                : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
            }`}
          >
            {batchRunning ? 'Stop' : 'Run all'}
          </button>
        </div>
      </div>

      {batch.length > 0 && <BatchProgress entries={batch} />}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {[...SCENARIOS]
          .sort((a, b) => a.order - b.order)
          .map((scenario) => {
            // A scenario naming a participant that is not registered cannot run;
            // saying so on the card beats a preflight failure.
            const missing = scenario.requires.filter((id) => !available.has(id));
            const blocked = missing.length > 0;
            const expectsFailure = scenario.expect.startsWith('Fails');

            const outcome = byId.get(scenario.id);

            return (
              <button
                key={scenario.id}
                type="button"
                disabled={disabled || blocked}
                onClick={() => onRun(scenarioConfig(scenario), scenario)}
                className="group flex flex-col rounded-md border border-line bg-surface-2 p-3 text-left transition hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <div className="flex items-start gap-2">
                  <h3 className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-ink">
                    {scenario.title}
                  </h3>
                  {outcome && outcome.status !== 'pending' ? (
                    <Badge
                      tone={
                        outcome.status === 'running'
                          ? 'accent'
                          : outcome.status === 'skipped'
                            ? 'neutral'
                            : outcome.status === 'passed'
                              ? 'pass'
                              : 'fail'
                      }
                    >
                      {outcome.status}
                    </Badge>
                  ) : expectsFailure ? (
                    <Badge tone="warn">finds bugs</Badge>
                  ) : scenario.duration === 'needs-a-phone' ? (
                    <Badge tone="warn">needs a phone</Badge>
                  ) : null}
                </div>

                <p className="mt-1.5 text-[11px] leading-snug text-muted">{scenario.question}</p>
                <p className="mt-2 border-t border-line/60 pt-2 text-[10.5px] leading-snug text-muted">
                  <span className="text-ink">Expect: </span>
                  {scenario.expect}
                </p>

                {blocked && (
                  <p className="mt-2 text-[10.5px] text-warn">
                    Needs {missing.join(', ')} — start the Inji stack to enable this.
                  </p>
                )}
                {outcome?.detail && (
                  <p
                    className={`mt-2 text-[10.5px] leading-snug ${
                      outcome.detail.startsWith('Not what') ? 'text-fail' : 'text-muted'
                    }`}
                  >
                    {outcome.detail}
                  </p>
                )}
                {!blocked && !outcome && (
                  <span className="mt-2 text-[10.5px] text-accent opacity-0 transition group-hover:opacity-100">
                    Run this →
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </section>
  );
}

/**
 * Progress across a batch.
 *
 * Counts "as expected" rather than "passed", because two of these scenarios are
 * supposed to fail. A batch where everything passes would mean the two runs
 * that find real defects had stopped finding them.
 */
function BatchProgress({ entries }: { entries: BatchEntry[] }) {
  const done = entries.filter((entry) => entry.status !== 'pending' && entry.status !== 'running').length;
  const surprises = entries.filter((entry) => entry.detail?.startsWith('Not what')).length;
  const width = entries.length === 0 ? 0 : (done / entries.length) * 100;

  return (
    <div className="mb-3 rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-ink">
          {done} of {entries.length} scenarios
        </span>
        <span className={`text-[11px] ${surprises > 0 ? 'text-fail' : 'text-muted'}`}>
          {surprises > 0
            ? `${surprises} did not match what the scenario expected`
            : done === entries.length
              ? 'All outcomes were as expected'
              : 'Running…'}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-sm bg-canvas">
        <div className="h-full rounded-sm bg-accent transition-[width] duration-300" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
