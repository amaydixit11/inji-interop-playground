import type { Participant, RunConfig, Scenario } from '@interop/shared';
import { SCENARIOS, scenarioConfig } from '@interop/shared';
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
  disabled,
}: {
  participants: Participant[];
  onRun: (config: RunConfig, scenario: Scenario) => void;
  disabled: boolean;
}) {
  const available = new Set(participants.map((participant) => participant.id));

  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Start here</h2>
          <p className="text-[11px] text-muted">
            Each of these answers one question about the stack. Pick one, or configure a run yourself below.
          </p>
        </div>
        <span className="text-[10.5px] text-muted">{SCENARIOS.length} scenarios</span>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {[...SCENARIOS]
          .sort((a, b) => a.order - b.order)
          .map((scenario) => {
            // A scenario naming a participant that is not registered cannot run;
            // saying so on the card beats a preflight failure.
            const missing = scenario.requires.filter((id) => !available.has(id));
            const blocked = missing.length > 0;
            const expectsFailure = scenario.expect.startsWith('Fails');

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
                  {expectsFailure ? (
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
                {!blocked && (
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
