# Claude Design prompt: manual bearing entry pages

The "ChaseMapper Flight Deck" redesign (see `templates/index.html` /
`static/css/chasemapper.css`) reskinned the main map GUI, and a follow-up
prompt (`doc/design-prompt-flight-deck-missing-screens.md`) covered the DOA
*display* panel. Untouched by either is the manual bearing *entry* side of
the feature: two fully-functional but pre-redesign pages, `templates/bearing_entry.html`
(route `/bearing`, "EasyBearing") and `templates/oclock.html` (route
`/oclock`). Both work end-to-end against the backend
(`add_manual_bearing` → `chasemapper/bearings.py`) but are plain
Bootstrap-default markup, and — more importantly — **neither is linked from
the main app anywhere**. They're only reachable by typing the URL directly.
This is the prompt to hand to [Claude Design](https://claude.ai/design) to
redesign both screens and figure out how they should actually be reached
from the main GUI.

## Prompt

> I'm extending the **ChaseMapper Flight Deck** design system (project
> `2d94b1c3-d551-4a86-ae08-68ffc3f59478`, `ChaseMapper Flight Deck.dc.html`).
> Please design two screens plus their entry point, using the same visual
> language already established there: near-black (#0a0d16) background, maize
> (#FFCB05) primary accent, blue (#6f9fd8) secondary/live accent, Space
> Grotesk for UI text, IBM Plex Mono for data/numeric values, rounded dark
> cards with subtle maize-tinted borders, and the existing icon style (24px
> grid, 1.8px stroke, round caps). Both screens are meant to be used
> one-handed, often while a vehicle is moving — assume mobile-first, large
> touch targets.
>
> **1. "EasyBearing" absolute-bearing entry** — currently a bare Leaflet map
> with `<`/`<<`/`<<<` and `>`/`>>`/`>>>` buttons that nudge a bearing value by
> 1°/5°/10°, and a plain text readout that you tap to submit. Redesign as:
> - A large, glanceable current-bearing readout (degrees), with the nudge
>   controls redesigned — maybe a compass-style rotary drag/dial, or
>   large +/- stepper buttons at a few increments, whichever reads better at
>   arm's length in a moving car.
> - A live bearing line drawn from the user's own position on a map
>   (map styling should follow the existing dark map treatment already in
>   the main app, not the plain OSM tiles this page uses now).
> - A clear, obviously-tappable submit action (currently: tap the readout
>   itself, which isn't discoverable) with confirmation feedback (toast/flash)
>   when a bearing is sent.
> - An inline warning state — not a browser `alert()`, which is what happens
>   today — for when location sharing isn't enabled yet, since a bearing
>   can't be recorded without it.
>
> **2. "O'Clock" relative-bearing entry** — currently a plain HTML ring of
> twelve numbered `<div>`s (1–12), each submitting a 30°-increment bearing
> relative to the user's current heading. Redesign as a proper clock-face /
> radial control with large touch targets, a "last bearing sent + when"
> readout, and the same location-sharing warning state as above. There's
> also a small "time-sequenced transmitter" status readout (which of up to 4
> Fox transmitters is currently active, counting down) that needs a compact
> treatment that doesn't compete with the clock face for attention.
>
> **3. Entry point** — today there is no way to reach either screen from the
> main map GUI; a user has to know to type `/bearing` or `/oclock` into the
> address bar. Design how these should be surfaced from the main app's
> topbar/menu-dock (recently redesigned — reference the current main-screen
> mockup for its structure) — e.g. a menu item, a mode toggle, or a
> slide-up sheet — for both desktop and mobile, and whether "EasyBearing" vs
> "O'Clock" should be one screen with a toggle or two clearly distinct
> destinations.

## Where these map to in the codebase

- **EasyBearing**: `templates/bearing_entry.html`, served at `/bearing`
  (`horusmapper.py`, `flask_bearing_entry`). Bearing nudge buttons are
  `L.easyButton` calls; submission is the `#bearing_data` click handler,
  which emits `add_manual_bearing` with `bearing_type: 'absolute'`.
- **O'Clock**: `templates/oclock.html` + `static/css/oclock.css`, served at
  `/oclock` (`horusmapper.py`, `flask_oclock`). The twelve `#clock1`–`#clock12`
  divs each call `handleOclockClick(degrees)`, which emits
  `add_manual_bearing` with `bearing_type: 'relative'`. The time-sequenced
  transmitter status comes from `updateTimeSeqClock()` / `#timeseq_notice`.
- **Entry point**: no current equivalent — nearest anchor is the
  topbar/menu-dock in `templates/index.html` (see the commit that introduced
  it, "Add topbar/menu-dock UI, chase-vehicle pruning, and route-panel
  updates").
- **Backend**: unaffected either way — `chasemapper/bearings.py`'s
  `add_bearing()` and the `add_manual_bearing` socket.io handler in
  `horusmapper.py` already fully support both absolute and relative
  submissions, including per-user fusion and the `bearing_rejected` event
  these pages currently surface via `alert()`.

## Fallback if a full design pass isn't wanted

A reasonable-effort option: reskin both pages in place with the existing
Flight Deck tokens/cards (dark map, maize accents, mono numerals) without
rethinking the interaction model, and add a single link/button into the main
GUI's menu-dock that opens them (new tab, or an iframe/modal) — no new
mockups required.
