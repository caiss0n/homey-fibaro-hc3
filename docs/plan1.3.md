# Fibaro HC3 Integration for Homey Pro — Plan v1.3

## Power & Energy Metering (measure_power / meter_power)

**App ID:** `org.saiful.fibarohc3`
**Plan version:** 1.3 (feature plan, builds on plan.md v1.0 + plan1.2.md)
**SDK:** Homey SDK 3 (compatibility ≥12.4.0)
**Date:** August 2026
**Status:** ✅ Implemented 2026-08-11 — 213/213 tests pass (9 new in test/power-metering.test.js), ESLint clean, publish-level validation passes. Live-verified with real readings (Corridor Light 3.2 W / 102.57 kWh, oil heaters ~1541/1908 kWh, Office Light 2.9 kWh).

---

## 1. Goal

Expose HC3 power consumption and energy metering on Homey devices:

- `properties.power` (watts, current draw) → Homey **`measure_power`**
- `properties.energy` (kWh, accumulated) → Homey **`meter_power`**

**Current state (verified 2026-08-11): NOT implemented** — zero references to
`measure_power`/`meter_power` in the codebase.

## 2. HC3 Data (verified on the live HC3)

| Device | Type | power | energy | interfaces |
|--------|------|-------|--------|------------|
| 25 NabeehaRoom Oil Heater | binarySwitch (zigbee) | 0.36 W | 1908.26 kWh | includes `power`, `energy` |
| 21 MasterBed Oil Heater | binarySwitch (zigbee) | 0.0 W | 1541.56 kWh | includes `power`, `energy` |
| 32 Office Light | binarySwitch (zwave) | 0.0 W | 2.9 kWh | includes `power`, `energy` |
| 100 Corridor Light | FGD212 dimmer (zwave) | 0.0 W | 102.57 kWh | includes `power`, `energy` (+ `resetMeter`) |
| 22 temperature sensor | temperatureSensor | — | — | none (sensors don't report) |

Facts that shape the design:

- Metering is reported by controllable devices (switches, dimmers, wall plugs,
  roller shutters); pure sensors never report it.
- Both values also arrive incrementally via `refreshStates` changes
  (`{id, power: …}` / `{id, energy: …}` change entries).
- The HC3 `interfaces` array advertises `power`/`energy` support up front —
  but reading values as they arrive is equally reliable and needs no manifest work.

## 3. Design

### 3.1 Dynamic capabilities on the base class (chosen)

Same pattern as `measure_battery` (v1.1): add the capability at runtime on first
sight of the value, so non-metering devices never show an empty tile.

New helper in `lib/hc3-device.js`, called from the base template method
`handleStateUpdate()` (which every driver already funnels through — after
`applyStateUpdate`, outside any command-cooldown gate):

```
updatePowerMetering(properties)
  properties.power  → measure_power  (W, rounded to 2 decimals, clamped ≥ 0)
  properties.energy → meter_power    (kWh, rounded to 2 decimals, clamped ≥ 0)
```

Consequences:

- **Every driver gets metering automatically** — switch, dimmer, window-covering,
  garage-door, lock… with zero per-driver code.
- Works identically for full fetches (`updateState`) and incremental
  `refreshStates` changes, because both funnel through `handleStateUpdate`.
- Power/energy updates keep flowing during command cooldowns (they're
  measurements, not controlled state) — the helper runs outside the cooldown gate.
- Compatible with v1.2 merging: a merged device (e.g. oil-heater switch with
  `[onoff, measure_temperature]` from pairing) still gains `measure_power` /
  `meter_power` dynamically at runtime; power comes from the primary device
  itself, never from siblings.

### 3.2 Alternatives considered

| Option | Why not chosen |
|--------|----------------|
| Static capabilities in `driver.compose.json` (Hubitat style) | Non-metering devices would show permanently empty power tiles; manifest churn per driver |
| Pairing-time override based on the HC3 `interfaces` array | Extra pairing complexity for no UX gain — the dynamic add lands on the first state fetch anyway |

### 3.3 Scope for v1.3

- In scope: `measure_power` (W), `meter_power` (kWh) on any device that reports
  `power`/`energy`.
- Out of scope: `measure_current`/`measure_voltage` (not commonly reported by the
  user's inventory), Homey driver-level `energy` object (energy panel mapping),
  `resetMeter` action (candidate for a v1.4 flow action), per-rail metering on
  multi-channel modules.

## 4. File-by-File Change List

| File | Change |
|------|--------|
| `lib/hc3-device.js` | New `updatePowerMetering(properties)` helper; called from the `handleStateUpdate` template method (all drivers inherit it). |
| `test/power-metering.test.js` | New suite: dynamic add, W/kWh mapping, rounding, negative clamp, unchanged-value skip, no-power devices stay clean, end-to-end via `handleRefreshStates({changes:[{id, power}]})`. |
| `scripts/live-check.js` | Print `power`/`energy` for a few known metering devices (21/25/32/100) so live runs prove the data path. |
| `docs/plan.md` | Changelog note (Phase 10 list). |

No manifest changes. No pairing changes.

## 5. Test Plan

1. First `power` sighting → `measure_power` dynamically added and set (W).
2. First `energy` sighting → `meter_power` dynamically added and set (kWh).
3. Values rounded to 2 decimals; negatives clamped to 0; `null`/non-numeric ignored.
4. Devices that never report power/energy never gain the capabilities (contact sensor case).
5. Unchanged values don't rewrite capabilities.
6. End-to-end: `handleRefreshStates` change `{id, power: 12.34}` routes to the paired device.
7. Cooldown: power updates flow while a switch command cooldown is active.
8. Regression: full existing suite stays green.

Live verification: `npm run test:live` prints power/energy readings for devices
21, 25, 32, 100; after `homey app run`, a paired switch shows live power + energy tiles.

## 6. Compatibility

- Additive only; already-paired devices gain the new capabilities at runtime on
  the next state update (no re-pairing needed).
- No changes to pairing data, routing, or the v1.2 merge logic.
