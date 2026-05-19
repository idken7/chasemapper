# CarPlay / Android Auto UI Constraints

This document defines platform-safe navigation UI constraints for in-car mode.

## Goals

- Keep the driver flow glanceable and low-interaction.
- Reuse `/api/mobile_state` and `/api/latest_route` outputs.
- Avoid free-form or multi-step controls while driving.

## Shared Constraints

- Max primary actions visible at once: 3
- Route recompute debounce: 3 seconds
- Status text max length: 42 chars
- Route polling from `/api/mobile_state`:
  - active guidance: 2s
  - passive map: 5s
  - background: 15-30s

## Allowed In-Car Actions

- Start route
- Stop route
- Recenter map
- Refresh route

Disallowed while moving:

- Free-text input
- Deep settings navigation
- Multi-step dialogs for core chase actions

## CarPlay-specific Notes

- Prefer map-centric template with concise trip card text.
- Keep action buttons stable to reduce cognitive load.
- Show only route ETA, distance, and target callsign in primary panel.

## Android Auto-specific Notes

- Use map template + single action strip where possible.
- Keep action count <= 3.
- Surface only route-critical metadata in pane rows.

## State Mapping Layer

Use dedicated mappers to transform backend payload into driver-safe view state:

- iOS: `CarPlayStateMapper`
- Android: `AutoStateMapper`

This keeps template logic independent from backend contract drift.
