# Fibaro HC3 Integration for Homey Pro — Plan v1.2

## Multi-Capability Devices via HC3 Sibling Merging

**App ID:** `org.saiful.fibarohc3`
**Plan version:** 1.2 (feature plan, builds on plan.md v1.0)
**SDK:** Homey SDK 3 (compatibility ≥12.4.0)
**Date:** August 2026
**Status:** ✅ Approved 2026-08-11 — implementation in progress

---

## Table of Contents

1. [Goal](#1-goal)
2. [Background & References](#2-background--references)
3. [HC3 Parent/Child Data Model](#3-hc3-parentchild-data-model)
4. [Design: Dynamic Sibling Capability Merging](#4-design-dynamic-sibling-capability-merging)
5. [Concrete Examples (from the live HC3)](#5-concrete-examples-from-the-live-hc3)
6. [File-by-File Change List](#6-file-by-file-change-list)
7. [Test Plan](#7-test-plan)
8. [Compatibility & Migration Notes](#8-compatibility--migration-notes)
9. [Out of Scope / Future](#9-out-of-scope--future)

---

## 1. Goal

Today (v1.1) every HC3 child device becomes a separate Homey device. But many physical
Fibaro/Aqara/Z-Wave devices expose several HC3 child devices under one parent
(e.g. a door sensor that reports both contact state AND temperature).

**v1.2 goal:** one physical device = one Homey device with multiple capabilities,
exactly like the reference project `homey-wled-yawsee` where a single device carries
`onoff, dim, light_hue, light_saturation, light_temperature, light_mode`.

Example (user's ask): HC3 device 368 "Patio door" (doorWindowSensor) and 367
"Device temperature" (temperatureSensor) are siblings under parent 366.
The paired Homey contact-sensor device for 368 should ALSO carry
`measure_temperature` fed by 367.

### Merging strategy (user decisions)

- **Dynamic merging** (not hardcoded combos): read a device's siblings, derive each
  sibling's capability from its type, and merge those capabilities — subject to the
  guardrails in section 4.3.
- **Exclusion**: merged children are excluded from their own drivers' pairing lists
  (no duplicate tiles; each HC3 device appears at most once).

---

## 2. Background & References

| Reference | What we take from it |
|-----------|---------------------|
| `homey-wled-yawsee` (`drivers/wled_strip`) | One Homey device hosting many capabilities; `registerCapabilityListener` per capability; capability-driven UI |
| Homey SDK pairing docs | `list_devices` items may override driver manifest defaults per device: `capabilities`, `capabilitiesOptions`, `icon`, `class`, `settings` (officially documented) |
| Home Assistant (`fibaro-homeAssistant/__init__.py`, pyfibaro `DeviceModel`) | HC3 grouping semantics: `parentId` links children; `has_endpoint_id`/`endpoint_id` exist for Z-Wave multi-channel; HA groups entities under one device registry entry |
| homebridge-fibaro-home-center | Device families treat children as separate accessories — HA's model is closer to our goal |

### Key difference from Home Assistant

HA creates multiple *entities* under one *device*. Homey has no entity layer —
a Homey device IS the tile. So in Homey we merge into ONE device with the union of
capabilities (the WLED model).

---

## 3. HC3 Parent/Child Data Model

Verified against the live HC3 (`/api/devices`, 2026-08-10):

- Every device has `id`, `parentId`, `type`, `name`, `roomID`, `properties`, `actions`.
- `parentId` points at the physical parent node. Special parents are the primary
  controllers: id 1 = `com.fibaro.zwavePrimaryController`, id 8 =
  `com.fibaro.zigbeePrimaryController`. Their children (`zwaveDevice`/`zigbeeDevice`
  nodes) are roots of device groups — NOT merge candidates themselves.
- A **group** = one non-controller parent + its children (same `parentId`).
- Children can have different `roomID`s and different names (e.g. temp child in the
  sensor's room, contact child named after the door).

### Real groups on the user's HC3

| Parent | Children | Group type |
|--------|----------|------------|
| 366 (zigbee) | 367 temperatureSensor "Device temperature", 368 doorWindowSensor "Patio door" | contact + temp |
| 291, 294, 312, 268, 274 | temperatureSensor + doorWindowSensor ("Main Door", "Garage Home Door", "Side Gate", "Upstair/Masterbed Sliding Door") | contact + temp |
| 349 (Node 55) | 350 motionSensor, 351 temperatureSensor ("Office"), 352 lightSensor | motion + temp + lux |
| 384, 388 | motionSensor + temperatureSensor + lightSensor (MasterBath, CommonBath) | motion + temp + lux |
| 299 (zigbee) | 300 temperatureSensor, 301 humiditySensor, 302 multilevelSensor (pressure) | all-sensor group |
| 20, 24 (zigbee) | binarySwitch + temperatureSensor (oil heaters) | switch + temp |
| 51, 57, 63… (Z-Wave wall modules) | remoteController + heatDetector + 2× binarySwitch | multi-primary (ambiguous) |
| 224 (Garage laser) | 2× binarySwitch + 2× temperatureSensor + 2× binarySensor | multi-primary (ambiguous) |

---

## 4. Design: Dynamic Sibling Capability Merging

### 4.1 Terminology

- **Group**: devices sharing the same `parentId`, where the parent is NOT a primary
  controller (`zwavePrimaryController`/`zigbeePrimaryController`). Grouping is by
  direct parent only.
- **Primary device**: the group member that becomes the Homey device; siblings'
  capabilities are merged into it.
- **Absorbable sibling**: a group member whose derived capability is a read-only
  `measure_*` capability.
- **`hc3Siblings`**: new optional field in Homey device `data`:
  `data = { hc3DeviceId: '368', hc3Siblings: [{ capability: 'measure_temperature', hc3DeviceId: '367' }] }`

### 4.2 Capability derivation

New helper in `app.js`:

```
siblingCapabilityFor(device) -> capabilityId | null
  com.fibaro.temperatureSensor                          -> measure_temperature
  com.fibaro.humiditySensor                             -> measure_humidity
  com.fibaro.lightSensor                                -> measure_luminance
  multilevelSensor + deviceRole=TemperatureSensor       -> measure_temperature
  multilevelSensor + deviceRole=HumiditySensor          -> measure_humidity
  multilevelSensor + deviceRole=LightSensor             -> measure_luminance
  (anything else)                                       -> null (not absorbable)
```

Primary detection: a device is "primary-capable" when its mapped driver is one of
`PRIMARY_CAPABLE_DRIVERS` (control/alarm drivers): switch, dimmer, window-covering,
garage-door, lock, motion-sensor, contact-sensor (+ smoke-sensor, leak-sensor for
future use). Only children whose `mapDeviceToDriver()` returns a driver participate
in merging at all — unmapped children (e.g. heatDetector) are invisible.

### 4.3 Merge rules (guardrails)

1. **Only `measure_*` siblings merge.** Controllable children (binarySwitch,
   multilevelSwitch, lock, shutter channels) and alarm children (heatDetector,
   motionSensor, contactSensor) are NEVER absorbed into another device.
2. **Primary selection**: exactly one primary-capable child → it wins. Zero
   primary-capable children (all-sensor group) → deterministic sensor ranking:
   temperature-sensor > humidity-sensor > light-sensor, ties by lowest HC3 id.
   The primary keeps its own name and room.
3. **Ambiguity rule**: groups with MORE THAN ONE primary-capable child are not
   merged at all (wall modules, garage laser group); all children stay standalone.
4. **One sibling per capability**: if two absorbable siblings offer the same
   capability, the one with the lowest HC3 id merges; the other stays standalone.
5. **Exclusion**: absorbed siblings are removed from their own drivers' pairing
   lists. Exclusion is computed from group structure (a merge actually happened),
   not from pairing state.

### 4.4 Pairing changes (`app.js`)

`getDevicesForDriver(driverId)` gains a grouping pass (single extra computation per
call, over the cached device list):

1. Build groups from the device list (`parentId` → members, excluding controller parents).
2. For each candidate that is the primary of its group with ≥1 absorbed sibling:
   - `capabilities: [...driverBaseCaps, ...siblingCaps]` (per-device override,
     SDK-documented). Driver base capabilities come from a `DRIVER_BASE_CAPABILITIES`
     constant in app.js — kept in sync with `driver.compose.json` files by a test.
   - `data.hc3Siblings: [{ capability, hc3DeviceId }, ...]`
   - name remains the primary's name
3. Absorbed siblings are filtered out of their own drivers' candidate lists.

### 4.5 State routing changes

- **`app.js` `findPairedDevices(hc3DeviceId)`** — additionally matches devices whose
  `data.hc3Siblings` contains the id.
- **`lib/hc3-device.js` `updateState()`** — fetches the primary AND each sibling;
  dispatches each as `handleStateUpdate({ id: <hc3 id>, ...properties })`. The id is
  now always present (refreshStates changes carry it natively; updateState injects it).
  Backward compatible: all v1.1 drivers ignore unknown fields. A sibling fetch failure
  is logged but never affects the primary's availability.

### 4.6 Device-class changes

Affected drivers route by `change.id` in `applyStateUpdate`:

```
if (String(change.id) === String(data.hc3DeviceId)) → existing primary mapping
else → resolveSiblingCapability(change.id) → applySiblingValue(capability, change)
```

Shared helpers added to `lib/hc3-device.js`:

- `resolveSiblingCapability(changeId)` → capabilityId | null
- `applySiblingValue(capabilityId, change)` — learns `unit` when present and applies:
  - `measure_temperature` → `toCelsius()` conversion (moved here from the temperature
    driver so every device can convert; unit tracked per device, default Celsius)
  - `measure_humidity` → clamp 0–100
  - `measure_luminance` → clamp ≥ 0

Cooldown interaction: the command cooldown only suppresses the CONTROLLED capability
(e.g. switch onoff) — sibling measures keep flowing during cooldown.

Affected drivers in v1.2: contact-sensor, motion-sensor, switch, temperature-sensor
(as all-sensor group primary), humidity-sensor, light-sensor. Untouched: lock,
garage-door, dimmer, window-covering, button.

---

## 5. Concrete Examples (from the live HC3)

### 5.1 The user's case — Patio door (group 366)

Contact Sensor pairing shows "Patio door" with
`capabilities: ['alarm_contact', 'measure_temperature']`,
`data: { hc3DeviceId: '368', hc3Siblings: [{ capability: 'measure_temperature', hc3DeviceId: '367' }] }`.
Temperature Sensor pairing no longer lists id 367.

### 5.2 Office multisensor (group 349)

Motion Sensor pairing: "55.0 Motion Sensor" with
`['alarm_motion', 'measure_temperature', 'measure_luminance']`, siblings 351 + 352.

### 5.3 Oil heater (group 20)

Switch pairing: "MasterBed Oil Heater" with `['onoff', 'measure_temperature']`,
sibling 22 — and its deviceClass dropdown can be set to "heater" (synergy with the
v1.1 per-device class feature).

### 5.4 All-sensor group (group 299, Master Bath)

No primary-capable child → temperature child is primary (rule 2):
"Master Bath Temperature" with `['measure_temperature', 'measure_humidity']`.
(Pressure child 302 stays unmapped — see section 9.)

### 5.5 Ambiguous groups (wall modules, garage laser)

Multiple primary-capable children → nothing merges; every child pairs standalone.

---

## 6. File-by-File Change List

| File | Change |
|------|--------|
| `app.js` | New `siblingCapabilityFor(device)`, `buildMergedDevices(devices)` (group build + merge rules), merge/exclusion inside `getDevicesForDriver()`. `findPairedDevices()` matches `hc3Siblings`. New exported constant `DRIVER_BASE_CAPABILITIES` (sync enforced by test). |
| `lib/hc3-device.js` | `updateState()` multi-fetch with per-id dispatch; new `resolveSiblingCapability()` + `applySiblingValue()`; `toCelsius()` moved here from the temperature driver. |
| `drivers/contact-sensor/device.js` | Route by `change.id` (primary → alarm_contact; sibling → applySiblingValue). |
| `drivers/motion-sensor/device.js` | Same routing (primary → alarm_motion). |
| `drivers/switch/device.js` | Same routing; cooldown suppresses only onoff. |
| `drivers/temperature-sensor/device.js` | Primary keeps unit learning + conversion (now inherited); siblings supported; gains battery support via `updateBatteryCapability()`. |
| `drivers/humidity-sensor/device.js`, `drivers/light-sensor/device.js` | Same routing (primary measure + siblings). |
| `test/` | New `test/sibling-merge.test.js`; consistency test for `DRIVER_BASE_CAPABILITIES` vs compose files; existing suite must stay green. |
| `scripts/live-check.js` | Pairing lists print merged capabilities (e.g. `Patio door [alarm_contact, measure_temperature]`). |
| `docs/plan.md` | Changelog note pointing at this plan. |

No manifest changes needed: driver base capabilities stay as-is; the per-device
`capabilities` override happens at pairing time (SDK-documented).

---

## 7. Test Plan

Unit tests (node:test, existing stub):

1. **Grouping**: groups built correctly; controller-parented children (parentId 1/8) excluded; dangling parentId handled.
2. **Merge rules**: only `measure_*` absorbed; primary selection (single primary-capable wins; sensor ranking for all-sensor groups); ambiguous group (2 switches) untouched; duplicate-capability siblings → lowest id merges, other stays standalone.
3. **Pairing**: contact-sensor item carries overridden capabilities + hc3Siblings; temperature-sensor list excludes the absorbed sibling; ungrouped devices unchanged.
4. **Routing**: `findPairedDevices` matches sibling ids; end-to-end: change `{id: 367, value: 19}` → merged Patio door device's `measure_temperature` = 19.
5. **updateState**: fetches primary + sibling(s) once each; sibling failure does not affect the primary (availability stays up).
6. **Cooldown interaction**: switch with temp sibling — during command cooldown, onoff updates are suppressed but measure_temperature still flows.
7. **Unit conversion**: sibling change `{value: 68, unit: 'F'}` → 20 °C.
8. **Consistency**: `DRIVER_BASE_CAPABILITIES` matches every `driver.compose.json`.
9. **Regression**: full existing suite stays green.

Live verification (`npm run test:live`):
- Contact Sensor list shows merged capabilities; id 367 absent from Temperature Sensor list.
- After pairing on Homey (`homey app run`): door open/close AND temperature update
  on the same device tile via the long-poller.

---

## 8. Compatibility & Migration Notes

- **Already-paired v1.1 devices keep working unchanged** (their `data` has no
  `hc3Siblings`; single-id routing still works). To gain merged capabilities a user
  removes and re-pairs the device — document in release notes.
- `data.hc3DeviceId` remains the primary id — additive-only change to pairing data.

---

## 9. Out of Scope / Future

- **Alarm-capability merging** (e.g. heatDetector into a switch): excluded by rule 1;
  reconsider for v1.3 with UX thought.
- **Pressure/other measure types** (group 299's barometer child): needs a
  deviceRole→capability mapping for multilevelSensor barometer roles +
  `measure_pressure` — v1.3.
- **RGBW color light driver** (4 devices on the user's HC3 incl. TV Unit): still
  pending from Phase 10, independent of this plan.
- **Z-Wave `endPointId` grouping**: current groups form via `parentId`; extend the
  group builder if HC3 ever reports sibling endpoints differently. Not needed for
  the verified inventory.
- **v2.0 (unchanged)**: Phase 7 thermostat, Phase 9 scenes + global variables.

