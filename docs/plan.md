# Fibaro Home Center 3 Integration for Homey Pro — Project Plan

**App ID:** `org.saiful.fibarohc3`  
**Version:** Planning v1.0  
**SDK:** Homey SDK 3 (compatibility ≥12.4.0)  
**Platform:** Local (runs on Homey Pro hardware)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Design](#2-architecture-design)
3. [HC3 REST API Reference](#3-hc3-rest-api-reference)
4. [Device Type Mapping](#4-device-type-mapping)
5. [Phased Implementation Plan](#5-phased-implementation-plan)
6. [Technical Decisions & Patterns](#6-technical-decisions--patterns)
7. [Driver Implementation Template](#7-driver-implementation-template)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Project Overview

### Purpose
Integrate Fibaro Home Center 3 (HC3) into Homey Pro via the HC3 REST API, enabling users to control and monitor their Fibaro smart home devices through the Homey ecosystem.

### Goals
- Provide bidirectional communication between Homey and HC3
- Support real-time device state updates via `/api/refreshStates`
- Auto-detect HC3 device types and map them to appropriate Homey drivers
- Follow proven patterns from existing hub integrations (Hubitat app)
- Implement incrementally, one device type per phase for manageable testing

### Success Criteria
- Users can configure HC3 connection via app settings
- Devices are auto-discovered during pairing based on HC3 device types
- State changes in HC3 reflect in Homey within 5 seconds (via refreshStates)
- Commands from Homey execute reliably on HC3 devices
- Clean error handling when HC3 is unreachable

### Reference Projects Analyzed
| Project | Purpose | Key Learnings |
|---------|---------|---------------|
| `com.hubitat.elevation` | Hubitat → Homey integration | Centralized API client, driver pattern, polling + webhooks, device-to-driver mapping logic |
| `homebridge-fibaro-home-center` | HC3 → HomeKit bridge | HC3 REST API endpoints, device type mappings, refreshStates usage, action commands |



---

## 2. Architecture Design

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HOMEY PRO DEVICE                             │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────────────┐  │
│  │ app.json │    │ api.js   │    │        app.js                │  │
│  │ (manifest)│    │(webhooks)│    │     (core logic)             │  │
│  └──────────┘    └────┬─────┘    └──────────┬───────────────────┘  │
│                       │                     │                      │
│                       ▼                     ▼                      │
│              ┌────────────────────────────────────────────┐        │
│              │         HC3 REST API Client                │        │
│              │   HTTP/HTTPS → http://<IP>/api/<endpoint>  │        │
│              │   Auth: Basic (username/password)          │        │
│              └───────────────────┬────────────────────────┘        │
│                                  │                                  │
│  ┌───────────────────────────────┴───────────────────────────────┐ │
│  │                    DRIVER LAYER                                │ │
│  │                                                               │ │
│  │  Each driver:                                                 │ │
│  │    ├── driver.js   → pairing flow, device discovery          │ │
│  │    └── device.js   → capability handlers, refreshStates sync │ │
│  │                                                               │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌────────────┐              │ │
│  │  │ temp-sensor │ │ motion-sensor│ │ switch    │ ...          │ │
│  │  └─────────────┘ └─────────────┘ └────────────┘              │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │ HTTP requests
                                   ▼
                         ┌─────────────────┐     ▲
                         │   FIBARO HC3    │─────┤ refreshStates polling
                         │   (REST API)    │     │ (every 3-5 seconds)
                         └─────────────────┘
```

### Core Components

#### 1. `app.js` — Central App Logic
**Class:** `FibaroHc3App extends Homey.App`

Responsibilities:
| Area | Methods |
|------|---------|
| **Initialization** | `onInit()` — loads settings, initializes API client, starts refreshStates poller |
| **Settings management** | Reacts to HC3 IP/username/password changes via `homey.settings.on('set')` |
| **API client layer** | `getBaseUrl()`, `makeRequest()` — HTTP requests with Basic Auth |
| **Device discovery** | `getDevices()` — fetches all devices from `/api/devices` |
| **Driver mapping** | `mapDeviceToDriver(device)` — analyzes HC3 device type and returns compatible Homey driver IDs |

#### 2. `api.js` — Internal API Endpoints
Responsibilities:
- Connection test endpoint for settings page
- Optional: webhook receiver if HC3 supports push notifications

#### 3. Settings Page (`settings/index.html`)
User-configurable fields:
| Field | Type | Description |
|-------|------|-------------|
| `hc3_ip` | string | HC3 IP address or hostname (e.g., "192.168.1.100" or "fibaro.local") |
| `hc3_username` | string | HC3 login username |
| `hc3_password` | password | HC3 login password (encrypted by Homey) |
| `refresh_interval` | number | refreshStates polling interval in seconds (default: 5, range: 2-10) |
| `enable_logging` | boolean | Toggle debug logging |

Features:
- "Test Connection" button → calls `/api/settings/info` to validate credentials
- Display HC3 system info on successful connection (firmware version, device count)
- Debug log viewer (last 100 entries)

#### 4. Drivers (`drivers/`)
Each driver follows the same pattern:
- `driver.js` — pairing flow that lists compatible HC3 devices
- `device.js` — runtime logic for individual paired devices

### File Structure
```
org.saiful.fibarohc3/
├── app.js                    # Core app class: API client, device discovery, refreshStates polling
├── api.js                    # Connection test endpoint + internal APIs
├── .homeycompose/app.json    # Manifest: drivers, capabilities, flows, localization keys
├── package.json              # Node dependencies (Homey SDK)
├── settings/
│   └── index.html            # Settings UI: IP/username/password input, connection test, log viewer
├── drivers/                  # One folder per device type
│   ├── temperature-sensor/   # Phase 1
│   ├── motion-sensor/        # Phase 2
│   ├── switch/               # Phase 3a
│   ├── dimmer/               # Phase 3b
│   ├── contact-sensor/       # Phase 4
│   ├── window-covering/      # Phase 5
│   ├── lock/                 # Phase 6
│   ├── thermostat/           # Phase 7
│   └── button/               # Phase 8
```
---

## 3. HC3 REST API Reference

### Authentication
- Method: HTTP Basic Auth (username/password)
- Header: `Authorization: Basic <base64(username:password)>`
- All endpoints require authentication

### Key Endpoints

| Endpoint | Method | Purpose | Used By |
|----------|--------|---------|---------|
| `/api/settings/info` | GET | Get system info, firmware version | Connection test, app init |
| `/api/devices` | GET | List all devices with properties | Device discovery, pairing |
| `/api/devices/{id}` | GET | Get single device details | State refresh |
| `/api/devices/{id}/action/{action}` | POST | Execute action on device | All controllable drivers |
| `/api/refreshStates?last=<timestamp>` | GET | Get state changes since timestamp | Real-time updates (polling) |
| `/api/scenes` | GET | List all scenes | Scenes integration (Phase 9) |
| `/api/scenes/{id}/execute` | POST | Execute a scene | Scenes integration |
| `/api/rooms` | GET | List rooms | Optional: room-based filtering |

### refreshStates Endpoint Details
- Returns array of device state changes since the given timestamp
- Timestamp is Unix epoch in seconds (e.g., `?last=1690000000`)
- Response format:
```json
[
  {
    "id": 42,
    "properties": {
      "value": 23.5,
      "batteryLevel": 85
    }
  }
]
```
- Polling interval: configurable (default 5 seconds, range 2-10)
- This is our primary mechanism for real-time state updates

### api documentation
- Ppenapi specification are in ./docs/swagger/

### Common Device Actions (from homebridge-fibaro-home-center)
| Action | Parameters | Used By |
|--------|------------|---------|
| `turnOn` | none | Switch, Dimmer, Light |
| `turnOff` | none | Switch, Dimmer, Light |
| `setValue` | [value] (0-100) | Dimmer, Window Covering |
| `setColor` | [r,g,b,w] | RGBW Controller |
| `open` | none | Roller Shutter, Barrier |
| `close` | none | Roller Shutter, Barrier |

---

## 4. Device Type Mapping

This table maps HC3 device types to Homey drivers. Used by `mapDeviceToDriver()` in app.js for auto-detection during pairing. Priority order matters — more specific types checked first.

### Sensors (Read-Only)
| HC3 Device Type | Homey Driver | Key Properties | Phase |
|-----------------|--------------|----------------|-------|
| `com.fibaro.temperatureSensor` | temperature-sensor | value (°C/°F) | 1 |
| `com.fibaro.motionSensor` | motion-sensor | value (boolean), detected | 2 |
| `com.fibaro.humiditySensor` | humidity-sensor | value (%) | TBD |
| `com.fibaro.lightSensor` | light-sensor | value (lux) | TBD |
| `com.fibaro.smokeSensor` | smoke-sensor | value (boolean), detected | TBD |
| `com.fibaro.multilevelSensor` + role=SmokeDetector | smoke-sensor | value | TBD |
| `com.fibaro.airQualitySensor` | air-quality | value (AQI) | TBD |
| `com.fibaro.pm25Sensor` | air-quality-pm25 | value (µg/m³) | TBD |

### Contact & Presence Sensors
| HC3 Device Type | Homey Driver | Key Properties | Phase |
|-----------------|--------------|----------------|-------|
| `com.fibaro.contactSensor` | contact-sensor | value (boolean), open | 4 |
| `com.fibaro.binarySensor` | binary-sensor (or contact-sensor, chosen at pairing) | value (boolean) → alarm_generic / alarm_contact | 4b |
| `com.fibaro.presenceSensor` | presence-sensor | value (boolean) | TBD |
| `com.fibaro.leakSensor` | leak-sensor | value (boolean), detected | TBD |

### Lighting & Switches
| HC3 Device Type | Homey Driver | Key Properties/Actions | Phase |
|-----------------|--------------|------------------------|-------|
| `com.fibaro.binarySwitch` + controlType=Lighting/WallLamp | switch | value (boolean), turnOn/turnOff | 3a |
| `com.fibaro.multilevelSwitch` | dimmer | value (0-100), setValue, turnOn/turnOff | 3b |
| `com.fibaro.colorController` | color-light | value, setColor(r,g,b,w) | TBD |
| `com.fibaro.FGRGBW*` | color-light | RGBW control via setColor | TBD |

### Window Coverings
| HC3 Device Type | Homey Driver | Key Properties/Actions | Phase |
|-----------------|--------------|------------------------|-------|
| `com.fibaro.rollerShutter` + controlType=BlindsWithPositioning | window-covering | value (0-100), open/close/stop | 5 |
| `com.fibaro.baseShutter` | window-covering-basic | open/close only | TBD |
| `com.fibaro.barrier` + controlType=GarageDoor/GateWithPositioning | garage-door | value, open/close | TBD |

### Security & Access Control
| HC3 Device Type | Homey Driver | Key Properties/Actions | Phase |
|-----------------|--------------|------------------------|-------|
| `com.fibaro.lock` | lock | value (boolean), lock/unlock | 6 |
| `com.fibaro.securitySystemPanel` | security-system | arm/disarm states | TBD |

### Climate Control
| HC3 Device Type | Homey Driver | Key Properties/Actions | Phase |
|-----------------|--------------|------------------------|-------|
| `com.fibaro.thermostat` | thermostat | mode, setpoint, currentTemp | 7 |
| `com.fibaro.HeatingPanelZone` | heating-zone | handTemperature | TBD |

### Buttons & Remotes
| HC3 Device Type | Homey Driver | Key Properties/Actions | Phase |
|-----------------|--------------|------------------------|-------|
| `com.fibaro.remoteController` + centralSceneSupport | button | keyId, value (Pressed/HeldDown) | 8 |
| `com.fibaro.remoteSceneController` | button | availableScenes | TBD |

### Special/Virtual Devices
| HC3 Device Type | Homey Driver | Notes | Phase |
|-----------------|--------------|-------|-------|
| Scenes (name starts with "_") | scene-switch | Momentary switch to trigger scene | 9 |
| Global Variables (boolean) | global-var-switch | Virtual on/off control | 9 |
| Global Variables (numeric) | global-var-dimmer | Virtual dimmer control | 9 |

### Auto-Detection Logic Priority Order
```javascript
// In mapDeviceToDriver(device):
1. thermostat → thermostat driver
2. lock → lock driver  
3. barrier + GarageDoor/GateWithPositioning → garage-door driver
4. rollerShutter + BlindsWithPositioning → window-covering driver
5. colorController / FGRGBW* → color-light driver
6. multilevelSwitch → dimmer driver
7. binarySwitch + Lighting/WallLamp controlType → switch driver
8. smokeSensor / MultilevelSensor+SmokeDetector → smoke-sensor driver
9. airQualitySensor → air-quality driver
10. pm25Sensor → air-quality-pm25 driver
11. contactSensor → contact-sensor driver
12. motionSensor → motion-sensor driver
13. presenceSensor → presence-sensor driver
14. leakSensor → leak-sensor driver
15. temperatureSensor → temperature-sensor driver
16. humiditySensor → humidity-sensor driver
17. lightSensor → light-sensor driver
18. remoteController + centralSceneSupport → button driver
```

| `stop` | none | Roller Shutter (with positioning) |

---

## 5. Phased Implementation Plan

Each phase delivers a working, testable increment. One device type per phase (except Phase 3 combines switch+dimmer) ensures manageable scope and easier debugging.

### Phase 0: Foundation & Infrastructure
**Goal:** Core app infrastructure ready for driver development

**Status: ✅ Complete** (2026-08-10) — 78/78 unit tests pass, ESLint clean, `homey app build` validates.

Tasks:
- [x] Update `.homeycompose/app.json` with app metadata, permissions, settings schema
- [x] Implement `app.js`:
  - [x] HC3 API client class (getBaseUrl, makeRequest with Basic Auth)
  - [x] Settings management (hc3_ip, hc3_username, hc3_password, refresh_interval)
  - [x] Device discovery: getDevices(), mapDeviceToDriver()
  - [x] getDevicesForDriver(driverId) for pairing flows
  - [x] sendDeviceAction(deviceId, action, params)
  - [x] refreshStates poller (configurable interval, default 5s)
  - [x] handleStateUpdate() routing to paired devices
- [x] Implement `api.js`:
  - [x] Connection test endpoint
- [x] Create `settings/index.html`:
  - [x] Input fields for HC3 credentials
  - [x] "Test Connection" button with feedback
  - [x] Display HC3 system info on success
  - [x] Debug log viewer (last 100 entries)
- [x] Update locales/en.json with settings labels
- [x] Unit tests (node:test, no new dependencies): `npm test`
- [x] `.homeyignore` added (excludes test/, docs/ from the packaged app)

Implementation notes:
- HTTP only for now (per decision); HTTPS support can be added later
- `mapDeviceToDriver()` returns a single driver id by priority order; also recognizes model-specific HC3 types (FGD212 → dimmer, FGWDS → switch, FGR* → window-covering, FGRGBW → color-light)
- refreshStates `last` is the HC3-internal counter echoed from each response (starts at 0), per swagger + homebridge implementation
- Poller uses a setTimeout chain via `this.homey.setTimeout`, survives HC3 outages (throttled logging), and resets `lastPoll` to 0 on restart
- `getDevices()` hardening (added 2026-08-10 after HC3 API stalls caused pairing failures): 30s TTL cache + in-flight dedup + stale-cache-on-error fallback; /api/devices gets a 30s timeout (large payload on big setups), other endpoints keep 10s
- HTTP keep-alive disabled for all HC3 requests (`http.Agent({ keepAlive: false })`, 2026-08-10): Node 19+ enables keep-alive by default, and reused sockets silently closed by the HC3 hang the next request until timeout. Fresh TCP connection per request now (curl-like behavior). Verified by test asserting `Connection: close` on the wire.
- Poll error backoff (2026-08-10, adopted from homebridge-fibaro comparison): after a failed poll the next poll is scheduled at +60s instead of the normal interval; normal cadence resumes on first success. Failure logging throttled to 1st failure then every ~10 min. Deliberately NOT adopted from homebridge: no request timeout (their hung poll stalls the whole poller forever via pollingUpdateRunning) — our 10s timeout keeps the poll loop alive through HC3 stalls.
- **Long-poll redesign (2026-08-10, adopted from Home Assistant's pyfibaro — fixes the "frequent timeout" root cause):** HC3's refreshStates holds requests server-side up to 30s waiting for changes (HA classifies it `local_push`). Our previous 10s client timeout was SHORTER than the server hold → every quiet period looked like a connection failure. New model: 35s timeout for refreshStates (pyfibaro's REFRESH_STATE_TIMEOUT), immediate re-poll after each response (250ms floor; the server-side hold is the rate limiter) → near-instant state updates with far fewer requests than 5s interval polling. Stop/restart aborts the in-flight long-poll (error tagged `ERR_HC3_ABORTED`, not counted as failure). The `refresh_interval` setting was removed (obsolete under long-polling).
- Test tooling fix (2026-08-10): `node --test` auto-discovers `test-*` files anywhere, so `scripts/test-connection.js` was accidentally executed as a test (it ran live commands!). Renamed to `scripts/live-check.js` and `npm test` now scopes explicitly to `test/*.test.js`.

Acceptance Criteria:
- User can enter HC3 IP/credentials in settings
- "Test Connection" validates credentials and shows HC3 firmware version
- refreshStates poller runs without errors when connected
- Device list fetches successfully from HC3

---

### Phase 1: Temperature Sensor Driver (Proof of Concept)
**Goal:** First working driver to validate the architecture

**Status: ✅ Complete** (2026-08-10) — 90/90 unit tests pass, ESLint clean, publish-level manifest validation passes. Live-verified against real HC3: 20 temperature sensors discovered for pairing.

Tasks:
- [x] Create `drivers/temperature-sensor/` folder structure
- [x] Add driver definition via `drivers/temperature-sensor/driver.compose.json` (Homey Compose):
  - Class: sensor
  - Capabilities: measure_temperature
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`:
  - [x] onPair(session) with list_devices handler — calls app.getDevicesForDriver('temperature-sensor')
  - [x] Filter HC3 devices by type com.fibaro.temperatureSensor (+ multilevelSensor with deviceRole=TemperatureSensor)
- [x] Implement `device.js`:
  - [x] Store HC3 device ID in device data: { hc3DeviceId: <id> }
  - [x] onInit() — initial state fetch from HC3 (marks device unavailable if HC3 unreachable, auto-recovers on next update)
  - [x] handleStateUpdate(properties) — map value → measure_temperature capability (skips unchanged values)
  - [x] Support temperature unit conversion if needed (F→C, unit learned from properties.unit)
- [x] Driver icon.svg + placeholder PNG images (replace with real artwork before publishing)
- [x] Unit tests: test/temperature-sensor.test.js (12 tests)

Verification on real HC3 (HC3-AlamHome): `npm run test:live` lists 20 pairing candidates for this driver.

Acceptance Criteria:
- User can pair a Fibaro temperature sensor via Homey UI
- Temperature readings appear in Homey within 5 seconds of HC3 update
- Device shows correct temperature in Homey app and flows

---

### Phase 2: Motion Sensor Driver
**Goal:** Add motion detection with flow triggers

**Status: ✅ Complete** (2026-08-10) — 101/101 unit tests pass, ESLint clean, publish-level validation passes. Live HC3 run confirmed 4 motion sensors auto-detected.

Tasks:
- [x] Create `drivers/motion-sensor/` folder structure
- [x] Add driver definition via `drivers/motion-sensor/driver.compose.json`:
  - Class: sensor
  - Capabilities: alarm_motion (⚠️ plan said `sensor_motion` — corrected to Homey's standard capability id; flow triggers "motion alarm on/off" come free with it)
  - measure_battery added dynamically at runtime when the HC3 reports batteryLevel (mains-powered devices never show an empty battery tile)
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`:
  - [x] Filter HC3 devices by type com.fibaro.motionSensor (+ multilevelSensor with deviceRole=MotionSensor)
- [x] Implement `device.js`:
  - [x] Map value property → alarm_motion capability
  - [x] Map batteryLevel → measure_battery (dynamic capability)
- [x] Refactor: extracted shared `lib/hc3-device.js` base class (initial fetch, availability tracking, error-safe updates, battery helper, setCapabilityIfChanged); temperature-sensor refactored onto it
- [x] Unit tests: test/motion-sensor.test.js (11 tests)

Acceptance Criteria:
- Motion events trigger Homey flows reliably
- Battery level shows correctly (if supported by device)

---

### Phase 3: Lighting Devices (Switch + Dimmer)
**Goal:** Enable control of basic lighting

**Status: ✅ Code complete** (2026-08-10) — 118/118 unit tests pass, ESLint clean, publish-level validation passes. ⚠️ Live command test prepared but blocked: HC3 device API stopped responding during verification (see note below).

#### Phase 3a: Switch Driver
Tasks:
- [x] Create `drivers/switch/` folder structure
- [x] Add driver definition via `drivers/switch/driver.compose.json`:
  - Class: socket (pairing items override to class `light` when deviceControlType is lighting: 2/5/7/23)
  - Capabilities: onoff
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`: filter com.fibaro.binarySwitch family
- [x] Implement `device.js`:
  - [x] Map value (boolean) → onoff
  - [x] onoff capability listener → sendDeviceAction turnOn/turnOff (throws on failure → Homey shows error)

#### Phase 3b: Dimmer Driver
Tasks:
- [x] Create `drivers/dimmer/` folder structure
- [x] Add driver definition via `drivers/dimmer/driver.compose.json`:
  - Class: light; Capabilities: onoff, dim; Pair template: list_devices → add_devices
- [x] Implement `driver.js`: filter com.fibaro.multilevelSwitch family
- [x] Implement `device.js`:
  - [x] Map value (0-100) → dim (0-1) + onoff
  - [x] dim listener → setValue [0-100]; onoff listener → turnOn/turnOff
  - [x] Race-condition prevention: 2s command cooldown ignores refreshStates updates for controlled capabilities (slider flicker prevention, plan §6)

Shared additions:
- [x] `lib/hc3-device.js`: startCommandCooldown()/isInCommandCooldown() helpers (COMMAND_COOLDOWN_MS = 2000)
- [x] `app.js`: getDeviceClassHint() — switch devices with lighting controlType pair as class `light`
- [x] Unit tests: test/switch.test.js (8), test/dimmer.test.js (9)
- [x] `npm run test:live` command test: toggles ONLY 'office light' (switch) and 'Corridor Light' (dimmer), restores original state (user-approved devices only, all others read-only)
- [x] Per-device configurable Homey class for switches (user request): `drivers/switch/driver.settings.compose.json` adds a "Device type" dropdown (20 onoff-sensible classes: socket, light, relay, fan, heater, kettle, coffeemachine, airpurifier, humidifier, pump, sprinkler, watervalve, tv, amplifier, speaker, mediaplayer, vacuumcleaner, lawnmower, siren, other); `device.js` onSettings() → setClass(), applied on init too. Note: Homey's native "What's plugged in?" virtual class (socket only) doesn't cover pump/sprinkler/watervalve/relay — hence a custom setting. Compose caveat learned: driver settings must live in `driver.settings.compose.json` (ignored inside driver.compose.json).

⚠️ HC3 stability note (2026-08-10): the HC3's HTTP API repeatedly flaps between healthy (≈25ms responses) and completely unreachable (TCP connect timeout) — verified with plain curl, so it's device-side, not app-side. Check HC3 CPU/load, Z-Wave network health, other integrations polling it (e.g. homebridge), and firmware updates. App-side mitigations in place: keep-alive disabled, per-request timeouts, throttled poll-error logging, device-list cache with stale fallback, crash-proof poller.

✅ Live command verification COMPLETE (2026-08-10): 'Office Light' (id 32) turnOn → on ✓ → restored off ✓; 'Corridor Light' (id 100) setValue 40 → 40% ✓ → restored 10% ✓. Only these two user-approved devices received commands; all others read-only.

### Phase 4: Contact Sensor Driver
**Goal:** Door/window open-close detection

**Status: ✅ Complete** (2026-08-10) — 137/137 unit tests pass, ESLint clean, publish-level validation passes. Live-verified: 10 contact sensors discovered on the real HC3.

Tasks:
- [x] Create `drivers/contact-sensor/` folder structure
- [x] Add driver definition via `drivers/contact-sensor/driver.compose.json`:
  - Class: sensor
  - Capabilities: alarm_contact (⚠️ plan said `sensor_contact` — corrected to Homey's standard capability id), measure_battery added dynamically when batteryLevel is reported
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`:
  - [x] Filter by type com.fibaro.contactSensor — extended (2026-08-10) after live HC3 data showed ZERO contactSensor devices: also com.fibaro.doorSensor, com.fibaro.doorWindowSensor, com.fibaro.windowSensor (per Home Assistant typemap + real HC3 inventory)
- [x] Implement `device.js`:
  - [x] Map value property → alarm_contact capability. Polarity (per homebridge getContactSensorState): value=true → contact OPEN → alarm_contact=true; value=false → closed
- [x] Unit tests: test/contact-sensor.test.js (9 tests) + 3 new mapping cases in app.test.js

Live-verified pairing candidates (10): TestUtils, Upstair/Masterbed Sliding Door, Main Door, Garage Home Door, Side Gate, 48.0 Door Sensor, Patio door, Nabeeha Window, Common Bath Window.

---

### Phase 4b: Binary Sensor Driver
**Goal:** Generic on/off sensors (e.g. Smart Implant binary inputs, laser beams)

**Status: ✅ Complete** (2026-09-20) — 223/223 unit tests pass, ESLint clean, debug-level validation passes. Live HC3 has 2 binary sensors (ids 238, 239 — children of the Garage laser Smart Implant group 224).

Tasks:
- [x] Create `drivers/binary-sensor/` folder structure
- [x] Add driver definition via `drivers/binary-sensor/driver.compose.json`:
  - Class: sensor
  - Capabilities: alarm_generic (new custom capability — no built-in capability fits a generic boolean sensor; boolean, getable, not setable, uiComponent `sensor` since `alarm` is not allowed for custom capabilities), measure_battery added dynamically when batteryLevel is reported
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`: filter by type com.fibaro.binarySensor
- [x] Implement `device.js`: map value property → alarm_generic. Polarity: value=true → sensor ACTIVE → alarm_generic=true; value=false → inactive. Tolerates 'true'/'false' strings
- [x] Sibling merging: binary-sensor added to PRIMARY_CAPABLE_DRIVERS (alarm children are never absorbed, plan v1.2 rule); group 224 binary sensors pair as standalone devices
- [x] Dual pairing (2026-09-20): DRIVER_TYPE_ALIASES lets binary sensors also appear in the Contact Sensor pairing list — the user picks the driver per device. Polarity matches (value=true → alarm on), and state routing is by HC3 id (findPairedDevices), so a binary sensor paired via either driver updates correctly
- [x] Unit tests: test/binary-sensor.test.js (12 tests) + mapping case in app.test.js + ambiguous-group assertion in sibling-merge.test.js

---

### Phase 5: Window Coverings (Roller Shutters)
**Goal:** Control blinds and roller shutters with position support

**Status: ✅ Complete** (2026-08-10) — 146/146 unit tests pass, ESLint clean, publish-level validation passes. Live check confirms 0 candidates on the current HC3 (its only shutter-family device, Garage Door id 227 with controlType 57, correctly maps to the later garage-door driver).

Tasks:
- [x] Create `drivers/window-covering/` folder structure
- [x] Add driver definition via `drivers/window-covering/driver.compose.json`:
  - Class: windowcoverings (⚠️ plan said "blind" — corrected; no such Homey class)
  - Capabilities: windowcoverings_state (up/idle/down) + windowcoverings_set (0-1) (⚠️ plan said `windowcovering`/`windowcovering_lift` — corrected to Homey standard capability ids)
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`:
  - [x] Filter com.fibaro.rollerShutter family (incl. FGR*/FGWR model types); garage/gate controlTypes (56/57) excluded → garage-door driver
- [x] Implement `device.js`:
  - [x] Map value (0-100, 0=closed/100=open per homebridge polarity) → windowcoverings_set (0-1)
  - [x] windowcoverings_state listener → open/close/stop via sendDeviceAction()
  - [x] windowcoverings_set listener → setValue [0-100] (positioning mode)
  - [x] Command cooldown prevents slider flicker during transitions
- [x] Unit tests: test/window-covering.test.js (9 tests)

Acceptance Criteria:
- Blinds can be opened/closed/stopped from Homey ✓ (open/close/stop actions; unit-tested command path, same as live-verified switch/dimmer path)
- Position percentage shows correctly for devices with positioning support ✓ (value 0-100 → 0-1 mapping, unit-tested)

---

### Phase 6: Lock Driver
**Goal:** Smart lock control

**Status: ✅ Complete** (2026-08-10) — 162/162 unit tests pass, ESLint clean, publish-level validation passes. Live check confirms 0 candidates on the current HC3 (no lock devices installed).

Tasks:
- [x] Create `drivers/lock/` folder structure
- [x] Add driver definition via `drivers/lock/driver.compose.json`:
  - Class: lock
  - Capabilities: locked (⚠️ plan said `lock` — corrected to Homey's standard capability id `locked`)
  - Pair template: list_devices → add_devices
- [x] Implement `driver.js`:
  - [x] Filter com.fibaro.lock + com.fibaro.doorLock (per Home Assistant typemap) + fallback: any device exposing a `secure` action (catches model-specific lock types)
- [x] Implement `device.js`:
  - [x] Map value → locked capability (true=locked/secured, per homebridge getLockCurrentState + HA)
  - [x] locked listener → secure/unsecure actions with [0] args (per homebridge setLockTargetState)
  - [x] Command cooldown prevents stale state flip during actuation
- [x] Unit tests: test/lock.test.js (7 tests) + 2 new mapping cases in app.test.js

Acceptance Criteria:
- Lock state syncs between HC3 and Homey ✓ (value → locked, unit-tested)
- Lock/unlock commands execute reliably from Homey ✓ (secure/unsecure [0], unit-tested command path — same as live-verified switch/dimmer path)

---

### Phase 7: Thermostat & Climate Control
**Goal:** HVAC control with mode and setpoint management

**Status: ⏭️ Deferred to app version 2.0** (decided 2026-08-10) — not part of the v1 release scope. Note: `mapDeviceToDriver()` already recognizes `com.fibaro.thermostat` / `com.fibaro.HeatingPanelZone` (returns `thermostat` / `heating-zone`), so v2 only needs the driver files and manifest definitions — no auto-detection changes required. Reference material for v2: homebridge `getFunctions.ts`/`setFunctions.ts` (thermostatMode, heatingThermostatSetpoint, coolingThermostatSetpoint, setThermostatMode/setHeatingThermostatSetpoint actions) and Home Assistant `climate.py`.

Tasks (v2):
- [ ] Create `drivers/thermostat/` folder structure
- [ ] Add driver definition via `drivers/thermostat/driver.compose.json`:
  - Class: thermostat
  - Capabilities: measure_temperature, target_temperature (verify current Homey capability ids against homey-lib — plan's `thermostat_heating_set_point`/`thermostat_cooling_set_point`/`thermostat_mode` are not standard ids), thermostat_mode if applicable
- [ ] Implement `driver.js`:
  - Filter HC3 devices by type com.fibaro.thermostat
- [ ] Implement `device.js`:
  - Map currentTemperature → measure_temperature
  - Map heatingSetpoint/coolingSetpoint → respective capabilities
  - Map mode (Off/Heat/Cool/Auto/Dry/Fan) → thermostat_mode
  - Handle setHeatingThermostatSetpoint/setCoolingThermostatSetpoint actions
  - Handle setThermostatMode action

Acceptance Criteria (v2):
- Thermostat modes and setpoints can be controlled from Homey
- Current temperature displays correctly

---

### Phase 8: Button/Remote Controller Driver
**Goal:** Flow triggers from physical buttons (Fibaro keypads, remotes)

**Status: ✅ Complete** (2026-08-10) — 170/170 unit tests pass, ESLint clean, publish-level validation passes. Live-verified: 16 remote controllers discovered on the real HC3.

Tasks:
- [x] Create `drivers/button/` folder structure
- [x] Add driver definition via `drivers/button/driver.compose.json`:
  - Class: button
  - Capabilities: none (event-driven only) ✓ (empty capabilities array validated)
  - Flow triggers: button_pressed, button_held, button_released, button_double_tapped — defined in `.homeycompose/flow/triggers/*.json`, each with a `button` number token + device arg filtered to the button driver (pattern per Hubitat app)
- [x] Implement `driver.js`:
  - [x] Filter HC3 devices by type com.fibaro.remoteController with centralSceneSupport (+ remoteSceneController)
- [x] Implement `device.js`:
  - [x] Map CentralSceneEvent keyId/keyAttribute → Homey flow triggers (arrive via refreshStates events → app.routeEvent → device.handleEvent; infra from Phase 0)
  - [x] Pressed→button_pressed, Pressed2→button_double_tapped, HeldDown→button_held, Released→button_released; unsupported attributes (Pressed3+) logged, not triggered
- [x] Unit tests: test/button.test.js (8 tests) incl. end-to-end refreshStates→routeEvent→handleEvent→flow-trigger chain

Acceptance Criteria:
- Button presses trigger Homey flows reliably ✓ (end-to-end unit test proves the chain)
- Multi-button devices report correct button number in flow state ✓ (keyId passed as `button` token + state)

---

### Phase 9: Scenes Integration + Advanced Features
**Goal:** Trigger HC3 scenes from Homey and expose global variables as virtual devices

**Status: ⏭️ Deferred to app version 2.0** (decided 2026-08-10) — not part of the v1 release scope. Reference material for v2: homebridge `platform.ts` `processScenes()` (scenes starting with `_` become switches; execute via POST `/api/scenes/{id}/execute`) and `pollerupdate.ts` `manageGlobalVariableDevice()` (global variables via `/api/globalVariables`, boolean → switch / numeric → dimmer, writes need admin credentials). Note: the v1 app has no admin-credential setting — global variable writes will need a new optional admin username/password setting in v2.

Tasks (v2):
- [ ] Create `drivers/scene-switch/` folder structure
- [ ] Add driver definition via `drivers/scene-switch/driver.compose.json`:
  - Class: switch (momentary)
  - Capabilities: onoff
- [ ] Implement scene discovery in app.js:
  - Fetch scenes from /api/scenes
  - Filter scenes starting with "_" for pairing
- [ ] Implement `device.js` for scene-switch:
  - Momentary behavior: SET true triggers scene, immediately resets to false
  - Call sendDeviceAction(sceneId, 'execute') or POST /api/scenes/{id}/execute

- [ ] Create `drivers/global-var-switch/` and `drivers/global-var-dimmer/`:
  - Expose HC3 global variables as virtual devices
  - Requires admin credentials for write operations

Acceptance Criteria (v2):
- HC3 scenes can be triggered from Homey flows
- Global variables appear as controllable switches/dimmers in Homey

---

### Phase 10: Polish & Additional Device Types
**Goal:** Fill gaps and add remaining device types based on user demand

Tasks (prioritized by commonality):
- [ ] Air quality sensor driver (com.fibaro.airQualitySensor)
- [ ] PM2.5 sensor driver (com.fibaro.pm25Sensor)
- [ ] Smoke sensor driver (com.fibaro.smokeSensor)
- [ ] Leak/water sensor driver (com.fibaro.leakSensor)
- [x] Humidity sensor driver (com.fibaro.humiditySensor) — implemented 2026-08-10 (user-selected): class sensor, measure_humidity (value %, clamped 0-100), dynamic measure_battery; 8 unit tests. Live-verified: pairs 'Master Bath Humidity' (HC3 id 301)
- [x] Light sensor driver (com.fibaro.lightSensor) — implemented 2026-08-10 (user-selected): class sensor, measure_luminance (value lux), dynamic measure_battery; 9 unit tests. Live-verified: 4 candidates (Lux Living 1, 55.0/MasterBath/CommonBath Light Sensors)
- [x] **Multi-capability devices via sibling merging (v1.2)** — implemented 2026-08-11 per `docs/plan1.2.md` (user request, WLED-style): HC3 parent/child groups merge dynamically — a primary device (contact/motion/switch/all-sensor) absorbs siblings' measure_* capabilities (temperature/humidity/luminance) via pairing-time `capabilities` override + `data.hc3Siblings`; absorbed children excluded from their own drivers' lists; state routing matches sibling ids. 17 new tests in test/sibling-merge.test.js (204 total). Live-verified on real HC3: 7 door/window sensors merged with temperature (incl. Patio door 368+367), 4 motion multisensors merged with temp+lux, oil-heater switches merged with temp, Master Bath all-sensor group merged (temp+humidity), ambiguous multi-primary groups (wall modules, garage laser) correctly untouched.
- [x] **Power & energy metering (v1.3)** — implemented 2026-08-11 per `docs/plan1.3.md` (user request): HC3 `properties.power` (W) → `measure_power`, `properties.energy` (kWh) → `meter_power`, added dynamically on first sight via base-class `updatePowerMetering()` called from the `handleStateUpdate` template — every driver inherits it, non-metering devices never show empty tiles, updates flow during command cooldowns, works on merged (v1.2) devices, no re-pairing needed for existing devices. 9 new tests in test/power-metering.test.js (213 total). Live-verified with real readings. Note: fixed a `deny delete` ACL on `.homeybuild/` (blocked `homey app build`) — cleared with `chmod -N`.
- [ ] Presence sensor driver (com.fibaro.presenceSensor)
- [x] Garage door driver (barrier with GarageDoor controlType) — **implemented ahead of schedule (2026-08-10, user request)** as `drivers/garage-door/`: class garagedoor, capability garagedoor_closed (toggle: close/open); value 0=closed else open (1/99 HC3 quirk normalized); 20s command cooldown (GARAGE_DOOR_COMMAND_COOLDOWN_MS) so slow door transit doesn't flip the toggle. 7 unit tests in test/garage-door.test.js. Live-verified: pairs 'Garage Door' (HC3 id 227, rollerShutter + controlType 57). No commands sent to it (not in the user-approved live command list).
- [ ] RGBW color light driver (com.fibaro.colorController, FGRGBW*)
- [ ] Valve driver for irrigation systems

Acceptance Criteria:
- Each new driver follows the established pattern
- Auto-detection works correctly for all supported device types


## 6. Technical Decisions & Patterns

### State Update Strategy: refreshStates Polling
- **Decision:** Use `/api/refreshStates?last=<timestamp>` polling from the start (not simple device-by-device polling)
- **Rationale:** 
  - More efficient than polling each device individually
  - Provides near real-time updates (3-5 second interval configurable by user)
  - Proven pattern from homebridge-fibaro-home-center
- **Implementation:**
  - Single poller in app.js runs every N seconds (default: 5)
  - Tracks last successful timestamp
  - Routes each device's state changes to paired Homey devices via handleStateUpdate()

### Device-to-Driver Auto-Detection
- **Decision:** Automatically detect which Homey driver(s) a HC3 device supports based on its type and properties
- **Rationale:** Better UX — users don't need to know technical details about their devices
- **Implementation:** mapDeviceToDriver(device) in app.js checks:
  - `device.type` (e.g., "com.fibaro.temperatureSensor")
  - `device.properties.controlType` for ambiguous types (binarySwitch can be light or outlet)
  - `device.interfaces` array for capability hints

### Error Handling Patterns (from Hubitat app)
- Capability listeners (`onCapabilityXxx`) throw on failure → Homey shows error to user
- Polling catches errors silently → one failing device doesn't crash the app
- refreshStates handler catches and logs → never crashes, always continues polling
- Connection failures logged but don't stop app; retry on next poll

### HTTP Client Design
- Use Node.js built-in `http`/`https` modules (no external dependencies)
- Basic Auth header constructed from settings username/password
- Support both HTTP and HTTPS (HC3 can use either)
- Optional: support custom CA certificate for self-signed HTTPS certs (like homebridge-fibaro does)

### Device Data Storage
Every paired device stores its HC3 ID in Homey's device data:
```javascript
{ hc3DeviceId: "42" }  // HC3 device ID as string
```
This is how refreshStates updates find the correct Homey device.

### Race Condition Prevention (for dimmers, sliders)
- Implement cooldown period after sending commands (e.g., 2 seconds)
- During cooldown, ignore refreshStates updates for that specific property
- Prevents slider flicker while user is dragging hue/saturation/brightness


## 7. Driver Implementation Template

Every driver follows this standard pattern:

### `driver.js` Template
```javascript
'use strict';

const Homey = require('homey');

class MyDriver extends Homey.Driver {

    async onPair(listDevices) {
        const devices = await this.homey.app.getDevicesForDriver(this.getData().id);
        
        return devices.map(device => ({
            name: device.name,
            data: { hc3DeviceId: String(device.id) },
        }));
    }

}

module.exports = MyDriver;
```

### `device.js` Template (Sensor — Read-Only)
```javascript
'use strict';

const Homey = require('homey');

class MyDevice extends Homey.Device {

    async onInit() {
        this.log('MyDevice initialized');
        await this.updateState();
    }

    async handleStateUpdate(properties) {
        try {
            if (properties.value !== undefined) {
                await this.setCapabilityValue('my_capability', properties.value);
            }
        } catch (error) {
            this.log('Error handling state update:', error.message);
        }
    }

    async updateState() {
        const deviceId = this.getData().hc3DeviceId;
        const deviceInfo = await this.homey.app.getDeviceInfo(deviceId);
        
        if (deviceInfo && deviceInfo.properties) {
            await this.handleStateUpdate(deviceInfo.properties);
        }
    }

    async onDeleted() {
        this.log('MyDevice deleted');
    }

}

module.exports = MyDevice;
```

### `device.js` Template (Controllable Device — e.g., Switch)
```javascript
'use strict';

const Homey = require('homey');

---

## 8. Testing Strategy

### Per-Phase Testing Checklist
Each phase should pass these tests before moving to the next:

1. **Settings & Connection**
   - [ ] HC3 credentials saved correctly in settings
   - [ ] "Test Connection" shows success with firmware version
   - [ ] App handles invalid credentials gracefully (shows error message)

2. **Device Pairing**
   - [ ] Driver pairing flow lists only compatible HC3 devices
   - [ ] Paired device stores correct hc3DeviceId in data
   - [ ] Device name matches HC3 device name

3. **State Sync (HC3 → Homey)**
   - [ ] Initial state loads correctly on pair
   - [ ] State changes in HC3 appear in Homey within 5 seconds
   - [ ] Multiple rapid changes don't cause errors or stale states

4. **Commands (Homey → HC3) — for controllable devices**
   - [ ] Commands from Homey UI execute on HC3 device
   - [ ] State syncs back correctly after command
   - [ ] Error shown in Homey if command fails

5. **Flows Integration**
   - [ ] Device capabilities work as conditions in flows
   - [ ] Device capabilities work as actions in flows
   - [ ] Sensor triggers (motion, contact) fire flow reliably

6. **Error Handling**
   - [ ] App continues running if HC3 becomes unreachable
   - [ ] Reconnection works when HC3 comes back online
   - [ ] Individual device failures don't crash the app

### Development Environment Setup
- Use Homey Simulator for development (https://apps.developer.homey.app/)
- Test against real HC3 instance on local network
- Enable debug logging during testing (`enable_logging: true`)

### Known Challenges & Mitigations
| Challenge | Mitigation |
|-----------|------------|
| HC3 rate limiting with many devices | Use refreshStates instead of individual device polling; throttle commands if needed |
| Self-signed HTTPS certificates on HC3 | Optional CA cert upload in settings (Phase 0+) |
| Device type ambiguity (e.g., binarySwitch as light vs outlet) | Check controlType property; allow user to choose during pairing if ambiguous |
| Race conditions with sliders/dimmers | Implement cooldown period after commands; ignore updates during cooldown |
| refreshStates returns large payloads with many devices | Process efficiently; only update capabilities that actually changed |

---

## Appendix A: HC3 Device Properties Reference

Common properties found in HC3 device objects (from swagger specs):

```json
{
  "id": 42,
  "name": "Living Room Temperature",
  "type": "com.fibaro.temperatureSensor",
  "baseType": "com.fibaro.multilevelSensor",
  "roomID": 5,
  "interfaces": ["temperature", "battery"],
  "properties": {
    "value": 23.5,
    "unit": "C",
    "batteryLevel": 85,
    "networkStatus": "OK"
  },
  "allowRemoteControl": true,
  "isPlugin": false
}
```

Key fields for auto-detection:
- `type` — primary device type identifier
- `baseType` — fallback if type is generic
- `interfaces` — array of supported interfaces (temperature, battery, switch, etc.)
- `properties.controlType` — disambiguates binarySwitch usage
- `properties.value` — current state/value

---

## Appendix B: Homey Capabilities Reference

Common capabilities used across drivers:

| Capability | Type | Used By |
|------------|------|---------|
| onoff | boolean | switch, dimmer, color-light |
| dim | number (0-1) | dimmer, color-light |
| sensor_motion | boolean | motion-sensor |
| sensor_contact | boolean | contact-sensor |
| measure_temperature | number (°C) | temperature-sensor, thermostat |
| lock | boolean | lock |
| windowcovering | boolean | window-covering (basic) |
| windowcovering_lift | number (0-100%) | window-covering (positioning) |
| sensor_smoke | boolean | smoke-sensor |
| measure_battery | number (%) | battery-powered devices (optional) |

---

*Document last updated: August 2026*  
*Maintained by: Saiful Alam <alam903@outlook.com>*



