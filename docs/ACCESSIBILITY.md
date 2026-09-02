# Accessibility and colour

The playground's whole purpose is to make a protocol exchange legible, so an
interface that is only legible to some people would be self-defeating. This
records what was changed, and — where a claim is measurable — the measurement,
so it can be re-checked rather than taken on trust.

## The palette was wrong, and it was wrong in the worst possible place

The shipped status colours were `#3fb950` pass and `#f85149` fail. Under the
Machado–Oliveira–Fernandes simulation of deuteranopia those two measure **ΔE 2.2**
apart in OKLab — indistinguishable. The single most consequential distinction in
this UI, *a conformance check passed versus failed*, was invisible to the
commonest form of colour blindness. That is not a nitpick about taste; it is the
one thing the interface exists to communicate.

The replacements were searched rather than picked: a coordinate-ascent search
over OKLCH, maximising the worst **all-pairs** CVD separation — all five colours
co-occur as run statuses, so separating only legend-adjacent pairs is not
enough — subject to each hue still reading as its role and clearing WCAG 4.5:1
against the panel surface.

| Role | Value | Contrast vs `#121821` |
| --- | --- | --- |
| accent | `#5cb0ff` | 7.7:1 |
| pass | `#6ce7a1` | 11.5:1 |
| fail | `#d5565d` | 4.5:1 |
| warn | `#df9717` | 7.3:1 |
| info | `#8c67f2` | 4.5:1 |

```
worst all-pairs CVD ΔE 13.5 (deutan) · tritan 10.2 · normal-vision 17.9
```

**2.2 → 13.5.** Reproduce with the data-viz validator:

```
node validate_palette.js "#5cb0ff,#6ce7a1,#d5565d,#df9717,#8c67f2" \
  --mode dark --surface "#121821" --pairs all
```

It reports one deliberate deviation: three of the five sit above the dark-mode
lightness band `[0.48, 0.67]`. That band is calibrated for 3:1 chart marks on a
lighter surface (`#1a1a19`) than this one, and a 3:1 mark is not a readable
label. Holding the band *and* 4.5:1 text contrast *and* ΔE ≥ 8 on a near-black
navy is over-constrained — the search returns nothing. Text contrast won.

Body text was measured too. Every ink token clears AA on every surface, the
tightest being `muted` on the deepest panel at **4.80:1**.

## Colour is never the only encoding

Even at ΔE 13.5, red-versus-green is still red-versus-green. So every status
carries a **glyph** as well as a hue — `✓` pass, `✕` fail, `!` warn, `◆`
expected failure, `·` neutral — and, wherever it fits, the word. The interface
should be readable with colour switched off entirely. Consequences elsewhere:

- Check tallies read `✓ 34 passed  ✕ 0 failed  ! 0 warned`, not three coloured numbers.
- The history matrix's `34 / 0 / 1` cell has a screen-reader-only expansion
  naming which number is which, plus the same text as a tooltip.
- The `*` marking an endpoint-only run is paired with hidden text saying what it means.
- Selection in the exchange list was background tint alone; it now also carries
  `aria-current` and a 2px accent edge.

## Structure and keyboard

- **Skip link** to the content region — the first tab stop.
- **One visible focus ring** (`:focus-visible`, accent, 2px offset) for
  everything, keyboard-only, so a mouse click leaves no ring behind.
- The view switcher is a real **tablist**: `ArrowLeft`/`ArrowRight` move between
  tabs, `Home`/`End` jump to the ends, and only the selected tab is a tab stop,
  so <kbd>Tab</kbd> steps past the group instead of through seven buttons.
- The user-action prompt is a real **dialog** — `role="dialog"`,
  `aria-modal`, labelled and described, focus moved to the primary action on
  open, focus **trapped** while it is up, and `Escape` aborts. Previously a
  keyboard user could tab behind a modal blocking the run.
- A **clickable `<tr>`** in the history matrix was unreachable by keyboard. The
  row stays clickable for the mouse; its action also has a real `Load` button.
- Tables have captions, `scope="col"` headers, a named actions column, and
  `scope="row"` on the field name in the comparison diff.
- Toggles report state: `aria-pressed` on Explain, "Problems only", the result
  filters and participant selection; `aria-expanded` on the disclosures.
- Form controls in the run builder are labelled with `htmlFor`, and their hint
  text moved out of the `<label>` into `aria-describedby` — previously the hint
  was folded into the control's accessible name.
- Progress and rate bars are `role="progressbar"` / `role="meter"` with real
  values; a `title` on a plain `<div>` is not an accessible name.
- Run outcomes are announced through a polite live region, since the result is
  otherwise conveyed by colour and by content appearing further down the page.
- `prefers-reduced-motion: reduce` disables the transitions and the pulse.

## Known gaps

- Not tested with a real screen reader; the ARIA is correct by construction and
  by DOM inspection, which is weaker evidence than VoiceOver or NVDA.
- The Mermaid sequence diagram renders to inline SVG with no text alternative.
  The same run is fully available as text in the protocol inspector, so the
  information is not lost, but the diagram itself is not described.
- No light theme. The palette search is parameterised by surface, so producing
  one is a re-run rather than a redesign.
