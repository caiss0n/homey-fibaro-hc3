'use strict';

const Homey = require('homey');
const http = require('http');

// The HC3 web server does not reliably handle reused keep-alive connections:
// a pooled socket that the HC3 has silently closed hangs the next request until
// timeout (Node 19+ enables keep-alive by default). Use a dedicated agent with
// keep-alive disabled — every request gets a fresh TCP connection, like curl.
const HC3_HTTP_AGENT = new http.Agent({ keepAlive: false });

const MAX_LOG_ENTRIES = 100;
const REQUEST_TIMEOUT_MS = 10000;
// /api/devices returns the full device list — a large payload on big HC3 setups
const DEVICES_REQUEST_TIMEOUT_MS = 30000;
// Short-lived cache for the device list (pairing flows look it up repeatedly)
const DEVICES_CACHE_TTL_MS = 30000;
// After a failed poll, back off to this delay (matches homebridge-fibaro's
// "next try in 1 minute") instead of hammering a struggling HC3
const POLL_ERROR_RETRY_DELAY_MS = 60000;
// The HC3 holds refreshStates requests open server-side for up to 30 seconds
// waiting for changes (long-polling — see pyfibaro REFRESH_STATE_TIMEOUT).
// The client timeout must exceed that hold, otherwise quiet periods look like
// connection failures. 35s it is.
const REFRESH_STATES_TIMEOUT_MS = 35000;
// Small floor between a successful poll response and the next poll. The next
// request is held server-side anyway; the floor only prevents a tight loop
// when the HC3 answers immediately (e.g. bursts of changes).
const MIN_DELAY_BETWEEN_POLLS_MS = 250;

// HC3 device.properties.deviceControlType values (numeric)
// Reference: homebridge-fibaro-home-center constants.
// Other known values (used in later phases): 55 = blinds with positioning.
const CONTROL_TYPE_GARAGE_DOOR = 56;
const CONTROL_TYPE_GATE_WITH_POSITIONING = 57;

// deviceControlType values that mean "this switch controls a light"
const LIGHTING_CONTROL_TYPES = [2, 5, 7, 23]; // LIGHTING, BEDSIDE_LAMP, WALL_LAMP, LIGHTING_ALT

// Plan v1.2 (sibling merging): drivers whose main capability is controllable or
// an alarm — such a child becomes the primary of its HC3 device group.
const PRIMARY_CAPABLE_DRIVERS = [
  'switch', 'dimmer', 'window-covering', 'garage-door', 'lock',
  'motion-sensor', 'contact-sensor', 'binary-sensor', 'smoke-sensor', 'leak-sensor',
];

// Ranking for all-sensor groups (no primary-capable child): temperature first
const SENSOR_PRIMARY_RANK = ['temperature-sensor', 'humidity-sensor', 'light-sensor'];

// HC3 device types that may pair through more than one driver: the key driver
// also lists devices whose mapped driver is one of the given aliases. Lets the
// user choose per device, e.g. a binary sensor can pair as a contact sensor
// (standard alarm_contact flows) or as a binary sensor (alarm_generic).
const DRIVER_TYPE_ALIASES = {
  'contact-sensor': ['binary-sensor'],
};

// Base capabilities per driver — MUST match drivers/<id>/driver.compose.json
// (sync enforced by test/sibling-merge.test.js)
const DRIVER_BASE_CAPABILITIES = {
  'temperature-sensor': ['measure_temperature'],
  'motion-sensor': ['alarm_motion'],
  'contact-sensor': ['alarm_contact'],
  'binary-sensor': ['alarm_generic'],
  'humidity-sensor': ['measure_humidity'],
  'light-sensor': ['measure_luminance'],
  switch: ['onoff'],
  dimmer: ['onoff', 'dim'],
  'window-covering': ['windowcoverings_state', 'windowcoverings_set'],
  'garage-door': ['garagedoor_closed'],
  lock: ['locked'],
  button: [],
};

class FibaroHc3App extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const { manifest } = this.homey;
    this.version = manifest.version;

    // In-memory log buffer shown on the settings page
    this.logs = [];

    // refreshStates poller state
    this.lastPoll = 0;
    this.pollerActive = false;
    this.pollerTimeout = null;
    this.pollerRestartTimeout = null;
    this.pollingUpdateRunning = false;
    this.consecutivePollFailures = 0;
    this.requestTimeoutMs = REQUEST_TIMEOUT_MS;

    // Device list cache (see getDevices)
    this.devicesCache = null;
    this.devicesFetchPromise = null;
    this.devicesCacheTtlMs = DEVICES_CACHE_TTL_MS;

    // In-flight requests that may need to be aborted (e.g. the long-poll)
    this._trackedRequests = {};

    this.loadSettings();

    this.homey.settings.on('set', (key) => this.onSettingsChanged(key));

    this.log(`Fibaro Home Center 3 initialized (build ${this.version})`);
    this.addLog(`App initialized (build ${this.version})`);

    this.startRefreshStatesPoller();
  }

  /**
   * (Re)load HC3 connection settings from the Homey settings store.
   */
  loadSettings() {
    this.hc3Ip = this.homey.settings.get('hc3_ip');
    this.hc3Username = this.homey.settings.get('hc3_username');
    this.hc3Password = this.homey.settings.get('hc3_password');
  }

  onSettingsChanged(key) {
    if (key === 'hc3_ip' || key === 'hc3_username' || key === 'hc3_password') {
      this.loadSettings();
      this.schedulePollerRestart();
    }
  }

  isConfigured() {
    return Boolean(this.hc3Ip && this.hc3Username && this.hc3Password);
  }

  /**
   * Add a log entry to the settings page log buffer (max 100 entries).
   */
  addLog(message) {
    if (!Array.isArray(this.logs)) this.logs = [];

    const loggingEnabled = this.homey.settings.get('enable_logging');
    if (loggingEnabled === false) return;

    const timestamp = new Date().toISOString().substring(11, 23);
    this.logs.push(`[${timestamp}] ${message}`);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.shift();
    }

    const header = `========================================\nFibaro HC3 Build: ${this.version || 'unknown'}\n========================================`;
    this.homey.settings.set('app_logs', `${header}\n${this.logs.join('\n')}`);

    this.log(message);
  }

  /* ----------------------------- HTTP client ----------------------------- */

  /**
   * Base URL of the HC3 REST API. HTTP only for now (local network).
   */
  getBaseUrl() {
    if (!this.hc3Ip) {
      throw new Error('HC3 settings not configured. Missing: IP address');
    }
    // Be lenient with user input: strip protocol prefix and trailing slashes
    const host = String(this.hc3Ip).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return `http://${host}/api`;
  }

  getAuthHeader() {
    const credentials = `${this.hc3Username || ''}:${this.hc3Password || ''}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Make an authenticated request to the HC3 REST API.
   * @param {string} endpoint - e.g. '/devices/42'
   * @param {object} [options]
   * @param {string} [options.method] - HTTP method (default GET)
   * @param {object|null} [options.body] - JSON body for POST/PUT
   * @param {object} [options.params] - Query string parameters
   * @returns {Promise<object|Array>} Parsed JSON response
   */
  async makeRequest(endpoint, {
    method = 'GET', body = null, params = {}, timeoutMs = null, trackRequest = null,
  } = {}) {
    const url = new URL(`${this.getBaseUrl()}${endpoint}`);
    Object.keys(params).forEach((key) => {
      url.searchParams.append(key, params[key]);
    });

    const headers = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    let payload = null;
    if (body !== null && body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    this.log(`HTTP ${method} ${url.toString()}`);

    const effectiveTimeoutMs = timeoutMs || this.requestTimeoutMs || REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      let req;

      // Optionally register this request so it can be aborted later
      // (used for the long-held refreshStates poll)
      const untrack = () => {
        if (trackRequest && req && this._trackedRequests && this._trackedRequests[trackRequest] === req) {
          delete this._trackedRequests[trackRequest];
        }
      };

      req = http.request(url, { method, headers, agent: HC3_HTTP_AGENT }, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          untrack();

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HC3 API error: ${res.statusCode} ${res.statusMessage || ''} (${method} ${endpoint})`));
            return;
          }

          if (!data) {
            resolve({});
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse HC3 response: ${error.message}`));
          }
        });
      });

      if (trackRequest) {
        if (!this._trackedRequests) this._trackedRequests = {};
        this._trackedRequests[trackRequest] = req;
      }

      req.setTimeout(effectiveTimeoutMs, () => {
        untrack();
        req.destroy(new Error(`Request timeout after ${effectiveTimeoutMs}ms`));
      });

      req.on('error', (error) => {
        untrack();
        const wrapped = new Error(`HTTP request to HC3 failed: ${error.message}`);
        if (error.code) wrapped.code = error.code;
        reject(wrapped);
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Abort an in-flight tracked request (e.g. the long-held refreshStates poll
   * when the poller is stopped or settings change). The resulting error carries
   * code ERR_HC3_ABORTED so callers can tell intentional aborts from failures.
   */
  abortTrackedRequest(key) {
    const req = this._trackedRequests && this._trackedRequests[key];
    if (req) {
      delete this._trackedRequests[key];
      const abortError = new Error('Request aborted');
      abortError.code = 'ERR_HC3_ABORTED';
      req.destroy(abortError);
    }
  }

  /* ---------------------------- HC3 API methods -------------------------- */

  async getSystemInfo() {
    return this.makeRequest('/settings/info');
  }

  /**
   * Get all devices from the HC3. The full list can be a large payload, so it
   * is cached briefly (pairing flows look it up repeatedly). Concurrent calls
   * share one in-flight request, and a stale cache is served if a fetch fails.
   */
  async getDevices({ forceRefresh = false } = {}) {
    const ttl = this.devicesCacheTtlMs || DEVICES_CACHE_TTL_MS;
    if (!forceRefresh && this.devicesCache && (Date.now() - this.devicesCache.fetchedAt) < ttl) {
      return this.devicesCache.devices;
    }

    if (this.devicesFetchPromise) {
      return this.devicesFetchPromise;
    }

    this.devicesFetchPromise = this.makeRequest('/devices', { timeoutMs: DEVICES_REQUEST_TIMEOUT_MS })
      .then((devices) => {
        if (Array.isArray(devices)) {
          this.devicesCache = { devices, fetchedAt: Date.now() };
        }
        return devices;
      })
      .catch((error) => {
        if (this.devicesCache) {
          this.addLog(`Device list fetch failed (${error.message}) — serving cached list`);
          return this.devicesCache.devices;
        }
        throw error;
      })
      .finally(() => {
        this.devicesFetchPromise = null;
      });

    return this.devicesFetchPromise;
  }

  async getDeviceInfo(deviceId) {
    return this.makeRequest(`/devices/${deviceId}`);
  }

  async getRooms() {
    return this.makeRequest('/rooms');
  }

  /**
   * Execute an action on a HC3 device, e.g. sendDeviceAction(42, 'setValue', [50])
   */
  async sendDeviceAction(deviceId, action, args = []) {
    const body = Array.isArray(args) && args.length > 0 ? { args } : {};
    this.addLog(`>>> Sending action to HC3 device ${deviceId}: ${action} ${JSON.stringify(args)}`);
    try {
      const result = await this.makeRequest(`/devices/${deviceId}/action/${action}`, { method: 'POST', body });
      this.addLog('<<< Action successful');
      return result;
    } catch (error) {
      this.addLog(`!!! Action failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Test the HC3 connection using /api/settings/info (and /api/devices for a device count).
   * Returns a result object instead of throwing, for direct use by the settings page API.
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, error: 'HC3 connection not configured. Missing IP address, username or password.' };
    }

    try {
      const info = await this.getSystemInfo();

      // Device count is best-effort; settings/info is the actual credential validation
      let deviceCount;
      try {
        const devices = await this.getDevices();
        deviceCount = Array.isArray(devices) ? devices.length : undefined;
      } catch (error) {
        this.addLog(`Could not fetch device count: ${error.message}`);
      }

      this.addLog(`Connection test successful (HC3: ${info.hcName || 'unknown'}, devices: ${deviceCount !== undefined ? deviceCount : '?'})`);

      return {
        success: true,
        info: {
          hcName: info.hcName,
          platform: info.platform,
          serialNumber: info.serialNumber,
          mac: info.mac,
          zwaveVersion: info.zwaveVersion,
          firmwareVersion: info.currentVersion && info.currentVersion.version ? info.currentVersion.version : undefined,
          deviceCount,
        },
      };
    } catch (error) {
      this.addLog(`Connection test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /* --------------------- Device → driver auto-detection ------------------ */

  /**
   * Map a HC3 device to the most specific compatible Homey driver id.
   * Priority order matters — more specific device types are checked first.
   * Returns null when the device type is not supported (yet).
   */
  mapDeviceToDriver(device) {
    if (!device || typeof device !== 'object') return null;

    const type = device.type || '';
    const properties = device.properties || {};
    const rawControlType = properties.deviceControlType;
    const controlType = typeof rawControlType === 'string' ? parseInt(rawControlType, 10) : rawControlType;
    const deviceRole = properties.deviceRole || '';

    // HC3 often reports model-specific device types; group them into families.
    // FGR(?!GBW) = roller shutter modules, FGRGBW is a color controller (rule 5).
    const isRollerShutterFamily = type === 'com.fibaro.rollerShutter'
      || /^com\.fibaro\.FGR(?!GBW)/.test(type)
      || /^com\.fibaro\.FGRM/.test(type)
      || /^com\.fibaro\.FGWR/.test(type);
    const isBaseShutter = type === 'com.fibaro.baseShutter' || type === 'com.fibaro.remoteBaseShutter';
    const isGarageControlType = controlType === CONTROL_TYPE_GARAGE_DOOR || controlType === CONTROL_TYPE_GATE_WITH_POSITIONING;

    // 1. Thermostats & climate
    if (type === 'com.fibaro.thermostat') return 'thermostat';
    if (type === 'com.fibaro.HeatingPanelZone') return 'heating-zone';

    // 2. Locks (doorLock per Home Assistant typemap; fallback: any device
    // exposing a secure action is a lock, e.g. model-specific lock types)
    if (type === 'com.fibaro.lock' || type === 'com.fibaro.doorLock') return 'lock';
    const actions = device.actions || {};
    if (actions.secure !== undefined) return 'lock';

    // 3. Garage doors & gates (barriers, or shutter-family devices configured as garage/gate)
    if (type === 'com.fibaro.barrier' || ((isRollerShutterFamily || isBaseShutter) && isGarageControlType)) {
      return 'garage-door';
    }

    // 4. Window coverings
    if (isBaseShutter) return 'window-covering-basic';
    if (isRollerShutterFamily) return 'window-covering';

    // 5. RGB(W) color lights
    if (type === 'com.fibaro.colorController' || /^com\.fibaro\.FGRGBW/.test(type)) {
      return 'color-light';
    }

    // 6. Dimmers (multilevel switches). FGWD(?!S): Walli Dimmer but not Walli Double Switch.
    if (type === 'com.fibaro.multilevelSwitch'
      || /^com\.fibaro\.FGD(?!W)/.test(type)
      || /^com\.fibaro\.FGWD(?!S)/.test(type)) {
      return 'dimmer';
    }

    // 7. Binary switches (lighting and generic on/off devices)
    // Note: deviceControlType (lighting vs. other device) only decides the Homey
    // device class in Phase 3; both cases map to the switch driver.
    if (type === 'com.fibaro.binarySwitch'
      || type === 'com.fibaro.developer.bxs.virtualBinarySwitch'
      || type === 'com.fibaro.satelOutput'
      || /^com\.fibaro\.FGWDS/.test(type)
      || /^com\.fibaro\.FGWP/.test(type)
      || /^com\.fibaro\.FGWOEF/.test(type)) {
      return 'switch';
    }

    // 8. Smoke sensors
    if (type === 'com.fibaro.smokeSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'SmokeDetector')) {
      return 'smoke-sensor';
    }

    // 9. Air quality sensors
    if (type === 'com.fibaro.airQualitySensor') return 'air-quality';

    // 10. PM2.5 sensors
    if (type === 'com.fibaro.pm25Sensor') return 'air-quality-pm25';

    // 11. Contact sensors (door/window). HC3 uses several types for these:
    // doorSensor, doorWindowSensor and windowSensor are all contact sensors.
    if (type === 'com.fibaro.contactSensor'
      || type === 'com.fibaro.doorSensor'
      || type === 'com.fibaro.doorWindowSensor'
      || type === 'com.fibaro.windowSensor') {
      return 'contact-sensor';
    }

    // 11b. Binary sensors (generic on/off sensors, e.g. Smart Implant inputs).
    // value=true means the sensor is active/triggered.
    if (type === 'com.fibaro.binarySensor') return 'binary-sensor';

    // 12. Motion sensors
    if (type === 'com.fibaro.motionSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'MotionSensor')) {
      return 'motion-sensor';
    }

    // 13. Presence sensors
    if (type === 'com.fibaro.presenceSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'PresenceSensor')) {
      return 'presence-sensor';
    }

    // 14. Leak sensors
    if (type === 'com.fibaro.leakSensor') return 'leak-sensor';

    // 15. Temperature sensors
    if (type === 'com.fibaro.temperatureSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'TemperatureSensor')) {
      return 'temperature-sensor';
    }

    // 16. Humidity sensors
    if (type === 'com.fibaro.humiditySensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'HumiditySensor')) {
      return 'humidity-sensor';
    }

    // 17. Light sensors
    if (type === 'com.fibaro.lightSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'LightSensor')) {
      return 'light-sensor';
    }

    // 18. Buttons / remotes with central scene support
    if (type === 'com.fibaro.remoteSceneController') return 'button';
    if (type === 'com.fibaro.remoteController' && this.hasCentralSceneSupport(properties)) return 'button';

    // Security system panel (reserved for a future phase)
    if (type === 'com.fibaro.securitySystemPanel') return 'security-system';

    return null;
  }

  /**
   * HC3 reports centralSceneSupport as an array or a JSON-encoded string.
   */
  hasCentralSceneSupport(properties) {
    let support = properties.centralSceneSupport;
    if (typeof support === 'string') {
      try {
        support = JSON.parse(support);
      } catch (error) {
        return false;
      }
    }
    return Array.isArray(support) && support.length > 0;
  }

  /**
   * Optional Homey device-class hint, used to override the driver's default class
   * during pairing (e.g. a binary switch configured as lighting pairs as a light).
   * Returns undefined when the driver's default class should be used.
   */
  getDeviceClassHint(device, driverId) {
    if (driverId === 'switch') {
      const properties = (device && device.properties) || {};
      const rawControlType = properties.deviceControlType;
      const controlType = typeof rawControlType === 'string' ? parseInt(rawControlType, 10) : rawControlType;
      if (LIGHTING_CONTROL_TYPES.includes(controlType)) {
        return 'light';
      }
    }
    return undefined;
  }

  /* ------------------ Sibling merging (plan v1.2) ------------------------ */

  /**
   * Derive the absorbable (read-only measure_*) Homey capability a sibling HC3
   * device contributes when merged, or null when it is not absorbable.
   */
  siblingCapabilityFor(device) {
    if (!device || typeof device !== 'object') return null;

    const type = device.type || '';
    const deviceRole = (device.properties || {}).deviceRole || '';

    if (type === 'com.fibaro.temperatureSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'TemperatureSensor')) {
      return 'measure_temperature';
    }
    if (type === 'com.fibaro.humiditySensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'HumiditySensor')) {
      return 'measure_humidity';
    }
    if (type === 'com.fibaro.lightSensor'
      || (type === 'com.fibaro.multilevelSensor' && deviceRole === 'LightSensor')) {
      return 'measure_luminance';
    }
    return null;
  }

  /**
   * Group devices by HC3 parentId and compute capability merges (plan v1.2).
   * Returns { merged: Map<primaryIdString, { driverId, siblings: [{capability, hc3DeviceId}] }>,
   *           absorbedIds: Set<string> }.
   */
  buildMergedDevices(allDevices) {
    const merged = new Map();
    const absorbedIds = new Set();

    const byId = new Map();
    for (const device of allDevices) byId.set(device.id, device);

    // Group children by parent; children of the primary controllers are group roots
    const groups = new Map();
    for (const device of allDevices) {
      const { parentId } = device;
      if (parentId === undefined || parentId === null) continue;
      const parent = byId.get(parentId);
      if (!parent) continue;
      const parentType = parent.type || '';
      if (parentType === 'com.fibaro.zwavePrimaryController'
        || parentType === 'com.fibaro.zigbeePrimaryController') continue;
      if (!groups.has(parentId)) groups.set(parentId, []);
      groups.get(parentId).push(device);
    }

    for (const children of groups.values()) {
      // Only children that map to a driver participate in merging
      const mapped = children
        .map((child) => ({ child, driverId: this.mapDeviceToDriver(child) }))
        .filter((entry) => entry.driverId !== null);
      if (mapped.length < 2) continue;

      const primaryCapable = mapped.filter((entry) => PRIMARY_CAPABLE_DRIVERS.includes(entry.driverId));

      let primaryEntry = null;
      if (primaryCapable.length === 1) {
        [primaryEntry] = primaryCapable;
      } else if (primaryCapable.length > 1) {
        continue; // Ambiguity rule: multiple control/alarm children → no merging
      } else {
        // All-sensor group: deterministic ranking (temperature > humidity > luminance)
        primaryEntry = mapped.slice().sort((a, b) => {
          const rankA = SENSOR_PRIMARY_RANK.indexOf(a.driverId);
          const rankB = SENSOR_PRIMARY_RANK.indexOf(b.driverId);
          const rankOrMaxA = rankA === -1 ? SENSOR_PRIMARY_RANK.length : rankA;
          const rankOrMaxB = rankB === -1 ? SENSOR_PRIMARY_RANK.length : rankB;
          if (rankOrMaxA !== rankOrMaxB) return rankOrMaxA - rankOrMaxB;
          return a.child.id - b.child.id;
        })[0];
      }

      // Absorb measure_* siblings — only capabilities the primary lacks natively,
      // at most one sibling per capability (lowest HC3 id wins)
      const primaryCaps = DRIVER_BASE_CAPABILITIES[primaryEntry.driverId] || [];
      const siblings = [];
      const seenCapabilities = new Set();
      const others = mapped
        .filter((entry) => entry !== primaryEntry)
        .sort((a, b) => a.child.id - b.child.id);
      for (const entry of others) {
        const capability = this.siblingCapabilityFor(entry.child);
        if (!capability || primaryCaps.includes(capability) || seenCapabilities.has(capability)) continue;
        seenCapabilities.add(capability);
        siblings.push({ capability, hc3DeviceId: String(entry.child.id) });
        absorbedIds.add(String(entry.child.id));
      }

      merged.set(String(primaryEntry.child.id), { driverId: primaryEntry.driverId, siblings });
    }

    return { merged, absorbedIds };
  }

  /**
   * Get HC3 devices compatible with a specific Homey driver (used by pairing flows).
   * Sibling merging (plan v1.2): a primary's pairing item carries the merged
   * capabilities + data.hc3Siblings; absorbed siblings are excluded from lists.
   */
  async getDevicesForDriver(driverId) {
    const allDevices = await this.getDevices();
    if (!Array.isArray(allDevices)) return [];

    const { merged, absorbedIds } = this.buildMergedDevices(allDevices);

    const aliases = DRIVER_TYPE_ALIASES[driverId] || [];

    return allDevices
      .filter((device) => {
        if (absorbedIds.has(String(device.id))) return false; // merged into a sibling's device
        const mappedDriverId = this.mapDeviceToDriver(device);
        return mappedDriverId === driverId || aliases.includes(mappedDriverId);
      })
      .map((device) => {
        const result = {
          name: device.name || `HC3 Device ${device.id}`,
          data: {
            hc3DeviceId: String(device.id),
          },
        };
        const classHint = this.getDeviceClassHint(device, driverId);
        if (classHint) {
          result.class = classHint;
          // Keep the switch driver's "Device type" setting in sync with the
          // class chosen during pairing (its dropdown default is 'socket')
          result.settings = { deviceClass: classHint };
        }
        const mergeInfo = merged.get(String(device.id));
        if (mergeInfo && mergeInfo.siblings.length > 0) {
          const baseCaps = DRIVER_BASE_CAPABILITIES[driverId] || [];
          const extraCaps = mergeInfo.siblings
            .map((sibling) => sibling.capability)
            .filter((capability) => !baseCaps.includes(capability));
          if (extraCaps.length > 0) {
            result.capabilities = [...baseCaps, ...extraCaps];
          }
          result.data.hc3Siblings = mergeInfo.siblings;
        }
        return result;
      });
  }

  /* ------------------------ refreshStates polling ------------------------ */

  startRefreshStatesPoller() {
    this.stopRefreshStatesPoller();

    if (!this.isConfigured()) {
      this.addLog('HC3 connection not configured — state poller not started');
      return;
    }

    this.addLog('Starting refreshStates long-poll (near-instant updates)');
    this.pollerActive = true;
    this.lastPoll = 0; // 0 = ask HC3 for all current states on the first poll
    this.schedulePoll(0);
  }

  stopRefreshStatesPoller() {
    this.pollerActive = false;
    if (this.pollerTimeout) {
      clearTimeout(this.pollerTimeout);
      this.pollerTimeout = null;
    }
    // Abort an in-flight long-poll so the stop takes effect immediately
    // instead of waiting out the server-side hold (up to 30s)
    this.abortTrackedRequest('poller');
  }

  restartRefreshStatesPoller() {
    this.addLog('Restarting refreshStates poller');
    this.startRefreshStatesPoller();
  }

  schedulePollerRestart() {
    // Debounce: the settings page saves several keys in quick succession
    if (this.pollerRestartTimeout) {
      clearTimeout(this.pollerRestartTimeout);
    }
    this.pollerRestartTimeout = this.homey.setTimeout(() => {
      this.pollerRestartTimeout = null;
      this.restartRefreshStatesPoller();
    }, 500);
    if (this.pollerRestartTimeout && this.pollerRestartTimeout.unref) this.pollerRestartTimeout.unref();
  }

  schedulePoll(delayMs) {
    if (this.pollerTimeout) {
      clearTimeout(this.pollerTimeout);
    }
    this.pollerTimeout = this.homey.setTimeout(() => {
      this.pollerTimeout = null;
      this.pollRefreshStates().catch((error) => {
        // Should not happen (pollRefreshStates catches internally) — last resort guard
        this.error('Unexpected poller error:', error);
      });
    }, delayMs);
    if (this.pollerTimeout && this.pollerTimeout.unref) this.pollerTimeout.unref();
  }

  async pollRefreshStates() {
    if (this.pollingUpdateRunning) return;
    this.pollingUpdateRunning = true;

    try {
      // Long-poll: the HC3 holds this request server-side (up to 30s) and
      // answers immediately when a device state changes. The 35s timeout must
      // exceed the server-side hold, otherwise quiet periods look like failures.
      const response = await this.makeRequest('/refreshStates', {
        params: {
          last: this.lastPoll,
          lang: 'en',
          rand: Math.random(),
        },
        timeoutMs: REFRESH_STATES_TIMEOUT_MS,
        trackRequest: 'poller',
      });

      if (this.consecutivePollFailures > 0) {
        this.addLog(`Connection to HC3 restored after ${this.consecutivePollFailures} failed poll(s)`);
        this.consecutivePollFailures = 0;
      }

      await this.handleRefreshStates(response);
    } catch (error) {
      // An intentional abort (poller stop/restart) is not a failure
      if (error.code !== 'ERR_HC3_ABORTED') {
        // Never let polling errors crash the app — log and retry with backoff.
        this.consecutivePollFailures += 1;
        // Log the first failure, then roughly every 10 minutes during an outage
        if (this.consecutivePollFailures === 1 || this.consecutivePollFailures % 10 === 0) {
          this.addLog(`refreshStates poll failed (${this.consecutivePollFailures}x): ${error.message}. Next poll in ${POLL_ERROR_RETRY_DELAY_MS / 1000}s`);
        }
      }
    } finally {
      this.pollingUpdateRunning = false;
      if (this.pollerActive) {
        // Healthy: re-poll (almost) immediately — the server-side hold is the
        // rate limiter, so updates arrive the moment they happen.
        // Failing: back off to once a minute.
        const nextDelay = this.consecutivePollFailures > 0
          ? POLL_ERROR_RETRY_DELAY_MS
          : MIN_DELAY_BETWEEN_POLLS_MS;
        this.schedulePoll(nextDelay);
      }
    }
  }

  /**
   * Route a refreshStates response to the paired Homey devices.
   */
  async handleRefreshStates(response) {
    if (!response || typeof response !== 'object') return;

    if (response.last !== undefined) {
      this.lastPoll = response.last;
    }

    const changes = Array.isArray(response.changes) ? response.changes : [];
    for (const change of changes) {
      if (change && change.id !== undefined) {
        await this.routeStateUpdate(String(change.id), change);
      }
    }

    const events = Array.isArray(response.events) ? response.events : [];
    for (const event of events) {
      if (event && event.data && event.data.deviceId !== undefined) {
        await this.routeEvent(String(event.data.deviceId), event);
      }
    }
  }

  async routeStateUpdate(hc3DeviceId, change) {
    const devices = this.findPairedDevices(hc3DeviceId);
    for (const device of devices) {
      if (typeof device.handleStateUpdate === 'function') {
        try {
          await device.handleStateUpdate(change);
        } catch (error) {
          this.addLog(`!!! State update failed for device ${hc3DeviceId}: ${error.message}`);
        }
      }
    }
  }

  async routeEvent(hc3DeviceId, event) {
    const devices = this.findPairedDevices(hc3DeviceId);
    for (const device of devices) {
      if (typeof device.handleEvent === 'function') {
        try {
          await device.handleEvent(event);
        } catch (error) {
          this.addLog(`!!! Event handling failed for device ${hc3DeviceId}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Find all paired Homey devices linked to the given HC3 device id — as the
   * primary id OR as a merged sibling id (plan v1.2).
   */
  findPairedDevices(hc3DeviceId) {
    const matches = [];
    const drivers = this.homey.drivers.getDrivers();

    for (const driverId of Object.keys(drivers)) {
      const devices = drivers[driverId].getDevices();
      for (const device of devices) {
        const data = device.getData();
        if (!data) continue;

        if (String(data.hc3DeviceId) === hc3DeviceId) {
          matches.push(device);
          continue;
        }

        const siblings = Array.isArray(data.hc3Siblings) ? data.hc3Siblings : [];
        if (siblings.some((sibling) => String(sibling.hc3DeviceId) === hc3DeviceId)) {
          matches.push(device);
        }
      }
    }

    return matches;
  }

}

// Exported for the consistency test (test/sibling-merge.test.js)
FibaroHc3App.DRIVER_BASE_CAPABILITIES = DRIVER_BASE_CAPABILITIES;

module.exports = FibaroHc3App;
