# cashflow web app — design rules

Loaded whenever Claude works on files under `web/` (moved here from the root
CLAUDE.md so it stops costing context in API-only work). The root CLAUDE.md's
rules still apply: money is integer cents, formatMoney is the only divider,
and the rest.

## Design system

Defined as Tailwind v4 tokens in `web/src/index.css`. Use the token
classes (`text-ink`, `bg-band`) — never raw hex or default Tailwind
colours like `gray-500`.

The palette comes from greenbar ledger paper, the banded accounting stock
that columns of figures have been printed on for a century. That's the
subject's own material.

| Token | Use |
|---|---|
| `paper` | page background |
| `band` | alternating row tint |
| `raised` | panels above the page |
| `ink` | body text |
| `muted` / `faint` | secondary text, labels |
| `rule` / `rule-str` | borders |
| `spend` | money out (oxblood) |
| `earn` | money in, cashback (pine) |

`spend` and `earn` are the only saturated colours in the app. Because
nothing competes with them they carry real meaning. **Don't add a third
accent colour.**

Type is IBM Plex Sans with IBM Plex Mono for figures. **Every number in a
column gets the `.tnum` class** — tabular figures, so amounts align on the
decimal instead of wobbling. This is non-negotiable in a money app.

Avoid: card grids with drop shadows, gradient washes, ALL-CAPS eyebrow
labels, emoji, and fade-in-on-scroll animation. Quiet surface, numbers as
the hero.

**Vivid is the one sanctioned exception** (Settings → Design, D135–D141):
an opt-in, per-browser second design with the `--color-vivid-*` palette,
emoji, and `motion`-library animation. Everything above still governs
Classic, which stays the default — never let Vivid-only colors, emoji or
motion leak into Classic, and keep new Vivid work behind `useDesign()`
(or `:root[data-design="vivid"]` in CSS).

**Glass is the second sanctioned design** (D233, Settings → Design): Apple's
Liquid Glass approach. It's a CSS layer on `:root[data-design="glass"]`
that repoints the shared tokens, and it renders Classic's component
branches. Glass goes on the floating layer only (sidebar, top bar, popover
panels, toasts); content stays solid. Keep its rules in that CSS block, and
respect its Reduce Transparency, Increase Contrast and Reduce Motion
fallbacks.

**Light, Dark or Auto applies to every design** (D234): `data-theme` on
`<html>` beside `data-design`. Each design repoints the shared tokens under
`[data-design="…"][data-theme="dark"]` in index.css, so keep using tokens.
A hard-coded light colour in a component breaks dark mode.

**One Classic exception (D171):** the statement reveal on Review — the
statement read into its rows right after a parse, in one of four styles
picked in Settings → Animation (D335; paper to ledger by default). It answers the person's own action and plays once, so it runs
in both designs (and the upload animation will join it). The Recurring
page's countdown rings (D184) are the other one, at the owner's request:
slow, once on arrival. Settings → People (D302) is the third, also at
the owner's request: tilt, count-up and staggered groups in every design,
off under Reduce Motion. The assistant's spark (D332) is the fourth, also at
the owner's request: a twinkle in the corner, in ink and greys in Classic,
resting while its panel is open and under Reduce Motion. The status icons
bottom-left (D333) are the fifth, also at the owner's request: the API's
heartbeat, the database's stacking discs and the theme icon move while
working, in greys only in every design; a grey ring pulses only when
something is down, off under Reduce Motion. The help button and what it opens
(D334) are the sixth, also at the owner's request: the bubble's dots type now
and then, and each line icon inside (menu, Support tiles, report form) moves
once on hover or arrival, off under Reduce Motion. "Where it's going" (D373) is the seventh, also at the
owner's request: a colour per category and pebbles that drift and knock (or tiles whose icons
drift, or a Wallet card whose colours move), picked in the card's own Design menu, in every design, all of it
off under Reduce Motion. Not a licence for motion
elsewhere in Classic.

## Controls and editing (D297–D301)

The owner had to flag these more than once. Check every new control for all
three before calling it done, and screenshot a focused field and an open menu.

**No browser-drawn controls.** No `<select>`, no `<datalist>`, no
`<input type="date">`. Use the app's own `Dropdown` (`inRow` inside an Apple
form row), `DatePicker` (`inRow` too) and `SuggestField` for typed-or-picked
text. Their popups are the browser's and look foreign next to everything else.

**No green focus ring.** `index.css` has an unlayered global `:focus-visible`
outline in `--color-earn`, and an unlayered rule beats Tailwind's layered
`outline-none`, so any new focusable element gets a green ring. Put new
panes inside an `.apple-pane` scope (accent-coloured ring; an inset edge
inside grouped lists; nothing on text fields, whose row tints instead).
Anything portalled to `<body>` (a popover, a calendar) needs the
`apple-pane` class on its panel, or it falls outside the scope.

**Editing doesn't move the page.** Edit turns each value into its field where
it already sits (the name inside the title), in the same row order as the
reading view. Rows that can't be edited fade; nothing else shifts. A value
nothing else knows is a field; one read off a statement or estimated is
shown, not edited. A single editable thing (a merchant's logo) is a picker
that applies at once with Undo, not an Edit mode.
