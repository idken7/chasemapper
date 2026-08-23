# Claude Design prompt: remaining Flight Deck screens

The "ChaseMapper Flight Deck" redesign (see `templates/index.html` /
`static/css/chasemapper.css`) reskinned every part of the app that had a
corresponding mockup screen or was a mechanical application of the existing
design tokens. Two components were deliberately left alone because they have
no equivalent in the original mockup — reskinning them would mean guessing
at a design rather than following one. This is the prompt to hand to
[Claude Design](https://claude.ai/design) to produce that missing design
work, referencing the existing project so the result stays consistent.

## Prompt

> I'm extending the **ChaseMapper Flight Deck** design system (project
> `2d94b1c3-d551-4a86-ae08-68ffc3f59478`, `ChaseMapper Flight Deck.dc.html`).
> Please design two additional screens/components using the same visual
> language already established there: near-black (#0a0d16) background, maize
> (#FFCB05) primary accent, blue (#6f9fd8) secondary/live accent, Space
> Grotesk for UI text, IBM Plex Mono for data/numeric values, rounded dark
> cards with subtle maize-tinted borders, and the existing icon style (24px
> grid, 1.8px stroke, round caps).
>
> **1. DOA Bearing Panel** — a real-time radio direction-finding display,
> currently a bare, unstyled floating widget bottom-right on the map (no
> equivalent in the existing mockup). It has two parts that sit together:
> - A **live polar/radar plot**: a 360° compass-style chart plotting
>   incoming bearing lines from one or more sources (each source gets a
>   distinct color), with a confidence/power dimension. Needs gridlines,
>   cardinal-direction labels (N/E/S/W), a legend when multiple sources are
>   active, and a sensible **empty state** (no bearings yet) that doesn't
>   just look broken.
> - A **compact readout row** below or beside it: latest bearing (degrees),
>   confidence %, signal power — small stat tiles matching the
>   DIST/ETA/DESCENT tile style from the Track screen.
>
> Design both a desktop floating-card version (bottom-right, near the zoom
> controls) and how it collapses/hides on mobile.
>
> **2. Route / Navigation screen — full turn-by-turn** — the existing
> "Route" mockup screens (desktop 02, mobile M2) only show a single "next
> turn" hero card + a drive-ETA/balloon-ETA bar. In the real app this needs
> to also present the **full step-by-step itinerary** (a routing engine
> returns an ordered list of turns, not just the next one), plus:
> - How the hero "next turn" card relates to the full list —
>   expandable/collapsible, or hero-on-top-of-scrollable-list?
> - Styling for an individual turn-list row (turn icon, street name,
>   distance to that turn) in both an "upcoming" and "completed/passed"
>   state.
> - A visual treatment for **alternative routes** if more than one route
>   option is offered.
> - How a user starts routing, picks their start point (chase car / GPS /
>   manual lat-lon), and stops routing — this currently lives in a plain
>   form-style modal; feel free to redesign that flow too if a different
>   pattern fits better.
> - Desktop (side panel, similar footprint to the existing APRS/Settings
>   panels) and mobile (the M2 full-screen treatment) variants.

## Where these map to in the codebase

- **DOA Bearing Panel**: `#bearing_table` / `#bearing_plot`, rendered via
  `L.control.custom(...)` in `templates/index.html` (search for
  `bearing_data` / `bearing_plot_control`); chart rendering in
  `static/js/bearings.js` (`micropolar`/d3). No CSS currently targets these
  containers.
- **Route / Navigation**: `#chaseRoutingModal` in `templates/index.html`
  (the start/stop config form) and the Leaflet Routing Machine itinerary
  panel (`.leaflet-routing-container`, populated by
  `static/js/chase_routing.js`) — currently only has outer card chrome
  (`static/css/chasemapper.css`, search for `.leaflet-routing-container`),
  its internal turn list is still Leaflet Routing Machine's stock markup.

## Fallback if a full design pass isn't wanted

A reasonable-effort dark reskin of both — recoloring what exists in place,
keeping the current turn-by-turn list structure and radar chart library as
they are — can be done directly against the codebase without new mockups,
if that's preferred over commissioning new screens.
