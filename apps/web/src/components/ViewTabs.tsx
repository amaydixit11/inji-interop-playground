import { useRef } from 'react';

export type View = 'live' | 'story' | 'sequence' | 'dashboard' | 'compare' | 'history' | 'sdk';

/** Label and one-line purpose per view; the purpose becomes the tooltip. */
export const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: 'live', label: 'Live run', hint: 'Run a scenario and watch every exchange as it happens' },
  { id: 'story', label: 'Story', hint: 'What happened in the last run, in prose, without assuming the protocols' },
  { id: 'sequence', label: 'Sequence', hint: 'The same run as a sequence diagram between the three roles' },
  { id: 'dashboard', label: 'Dashboard', hint: 'Pass rates and check outcomes across every run so far' },
  { id: 'compare', label: 'Compare', hint: 'Two runs side by side, check by check' },
  { id: 'sdk', label: 'SDK', hint: "MOSIP's own verification SDK, embedded, talking to a live verify-service" },
  { id: 'history', label: 'History', hint: 'Every run as a matrix, exportable as Markdown' },
];

/**
 * The view switcher as a real tablist: arrow keys move between tabs, Home and
 * End jump to the ends, and only the selected tab is a tab stop — so Tab moves
 * past the whole group rather than through seven buttons.
 */
export function ViewTabs({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (delta: number | 'first' | 'last') => {
    const index = VIEWS.findIndex((entry) => entry.id === view);
    const next =
      delta === 'first' ? 0
      : delta === 'last' ? VIEWS.length - 1
      : (index + delta + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next].id);
    // Focus has to follow selection or the arrow keys stop working after one press.
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="View"
      className="flex gap-0.5 rounded-lg border border-line bg-surface-2 p-1"
      onKeyDown={(event) => {
        const actions: Record<string, () => void> = {
          ArrowRight: () => move(1),
          ArrowLeft: () => move(-1),
          Home: () => move('first'),
          End: () => move('last'),
        };
        const action = actions[event.key];
        if (!action) return;
        event.preventDefault();
        action();
      }}
    >
      {VIEWS.map((entry) => {
        const selected = view === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={selected}
            aria-controls="view-panel"
            tabIndex={selected ? 0 : -1}
            title={entry.hint}
            onClick={() => onChange(entry.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
              selected
                ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgb(92_176_255_/_0.35)]'
                : 'text-muted hover:bg-surface-3 hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
