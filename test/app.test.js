'use strict';

const {
  describe, it, before, after,
} = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('./helpers/homey-stub');

describe('configuration & URL building', () => {
  it('getBaseUrl throws when IP is not configured', () => {
    const app = createApp();
    app.loadSettings();
    assert.throws(() => app.getBaseUrl(), /not configured/);
  });

  it('getBaseUrl builds the API URL from the IP address', () => {
    const app = createApp({ settings: { hc3_ip: '192.168.1.100' } });
    app.loadSettings();
    assert.strictEqual(app.getBaseUrl(), 'http://192.168.1.100/api');
  });

  it('getBaseUrl tolerates protocol prefix and trailing slashes in user input', () => {
    const app = createApp({ settings: { hc3_ip: 'https://192.168.1.100/' } });
    app.loadSettings();
    assert.strictEqual(app.getBaseUrl(), 'http://192.168.1.100/api');
  });

  it('getAuthHeader returns a Basic auth header', () => {
    const app = createApp({ settings: { hc3_username: 'admin', hc3_password: 'secret' } });
    app.loadSettings();
    const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    assert.strictEqual(app.getAuthHeader(), expected);
  });

  it('isConfigured requires IP, username and password', () => {
    const app = createApp({ settings: { hc3_ip: '192.168.1.100', hc3_username: 'admin' } });
    app.loadSettings();
    assert.strictEqual(app.isConfigured(), false);

    const configured = createApp({
      settings: { hc3_ip: '192.168.1.100', hc3_username: 'admin', hc3_password: 'secret' },
    });
    configured.loadSettings();
    assert.strictEqual(configured.isConfigured(), true);
  });
});

describe('mapDeviceToDriver', () => {
  const app = createApp();

  const cases = [
    // 1. Thermostats & climate
    [{ type: 'com.fibaro.thermostat' }, 'thermostat'],
    [{ type: 'com.fibaro.HeatingPanelZone' }, 'heating-zone'],

    // 2. Locks
    [{ type: 'com.fibaro.lock' }, 'lock'],
    [{ type: 'com.fibaro.doorLock' }, 'lock'],
    [{ type: 'com.fibaro.vendorLock', actions: { secure: {}, unsecure: {} } }, 'lock'],

    // 3. Garage doors & gates
    [{ type: 'com.fibaro.barrier' }, 'garage-door'],
    [{ type: 'com.fibaro.barrier', properties: { deviceControlType: 56 } }, 'garage-door'],
    [{ type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 56 } }, 'garage-door'],
    [{ type: 'com.fibaro.baseShutter', properties: { deviceControlType: 57 } }, 'garage-door'],

    // 4. Window coverings
    [{ type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 55 } }, 'window-covering'],
    [{ type: 'com.fibaro.rollerShutter' }, 'window-covering'],
    [{ type: 'com.fibaro.FGRM222' }, 'window-covering'],
    [{ type: 'com.fibaro.baseShutter' }, 'window-covering-basic'],
    [{ type: 'com.fibaro.remoteBaseShutter' }, 'window-covering-basic'],

    // 5. RGB(W) color lights
    [{ type: 'com.fibaro.colorController' }, 'color-light'],
    [{ type: 'com.fibaro.FGRGBW442' }, 'color-light'],

    // 6. Dimmers
    [{ type: 'com.fibaro.multilevelSwitch' }, 'dimmer'],
    [{ type: 'com.fibaro.FGD212' }, 'dimmer'],
    [{ type: 'com.fibaro.FGWD111' }, 'dimmer'],

    // 7. Binary switches (incl. string controlType and Walli Double Switch, which must NOT match dimmer)
    [{ type: 'com.fibaro.binarySwitch', properties: { deviceControlType: 2 } }, 'switch'],
    [{ type: 'com.fibaro.binarySwitch', properties: { deviceControlType: '7' } }, 'switch'],
    [{ type: 'com.fibaro.binarySwitch', properties: { deviceControlType: 1 } }, 'switch'],
    [{ type: 'com.fibaro.binarySwitch' }, 'switch'],
    [{ type: 'com.fibaro.FGWDS221' }, 'switch'],
    [{ type: 'com.fibaro.FGWP102' }, 'switch'],
    [{ type: 'com.fibaro.developer.bxs.virtualBinarySwitch' }, 'switch'],

    // 8. Smoke sensors
    [{ type: 'com.fibaro.smokeSensor' }, 'smoke-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'SmokeDetector' } }, 'smoke-sensor'],

    // 9./10. Air quality
    [{ type: 'com.fibaro.airQualitySensor' }, 'air-quality'],
    [{ type: 'com.fibaro.pm25Sensor' }, 'air-quality-pm25'],

    // 11. Contact sensors (all HC3 door/window type variants)
    [{ type: 'com.fibaro.contactSensor' }, 'contact-sensor'],
    [{ type: 'com.fibaro.doorSensor' }, 'contact-sensor'],
    [{ type: 'com.fibaro.doorWindowSensor' }, 'contact-sensor'],
    [{ type: 'com.fibaro.windowSensor' }, 'contact-sensor'],

    // 12./13. Motion & presence
    [{ type: 'com.fibaro.motionSensor' }, 'motion-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'MotionSensor' } }, 'motion-sensor'],
    [{ type: 'com.fibaro.presenceSensor' }, 'presence-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'PresenceSensor' } }, 'presence-sensor'],

    // 14. Leak sensors
    [{ type: 'com.fibaro.leakSensor' }, 'leak-sensor'],

    // 15./16./17. Temperature, humidity, light
    [{ type: 'com.fibaro.temperatureSensor' }, 'temperature-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'TemperatureSensor' } }, 'temperature-sensor'],
    [{ type: 'com.fibaro.humiditySensor' }, 'humidity-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'HumiditySensor' } }, 'humidity-sensor'],
    [{ type: 'com.fibaro.lightSensor' }, 'light-sensor'],
    [{ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'LightSensor' } }, 'light-sensor'],

    // 18. Buttons / remotes (centralSceneSupport as array or JSON string)
    [{ type: 'com.fibaro.remoteController', properties: { centralSceneSupport: [{ keyId: 1 }] } }, 'button'],
    [{ type: 'com.fibaro.remoteController', properties: { centralSceneSupport: '[{"keyId":1}]' } }, 'button'],
    [{ type: 'com.fibaro.remoteController', properties: { centralSceneSupport: [] } }, null],
    [{ type: 'com.fibaro.remoteController', properties: { centralSceneSupport: 'not-json' } }, null],
    [{ type: 'com.fibaro.remoteSceneController' }, 'button'],

    // Security system panel
    [{ type: 'com.fibaro.securitySystemPanel' }, 'security-system'],

    // Unsupported / malformed input
    [{ type: 'com.fibaro.multilevelSensor' }, null],
    [{ type: 'com.fibaro.unknownDeviceType' }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ];

  for (const [device, expected] of cases) {
    const label = device && device.type ? device.type : JSON.stringify(device);
    it(`maps ${label} → ${expected}`, () => {
      assert.strictEqual(app.mapDeviceToDriver(device), expected);
    });
  }
});

describe('getDevicesForDriver', () => {
  it('filters and maps HC3 devices for a driver', async () => {
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 42, name: 'Living Room Temp', type: 'com.fibaro.temperatureSensor', properties: {},
      },
      {
        id: 43, name: 'Hallway Motion', type: 'com.fibaro.motionSensor', properties: {},
      },
      {
        id: 44, name: 'Bedroom Temp', type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'TemperatureSensor' },
      },
    ];

    const result = await app.getDevicesForDriver('temperature-sensor');
    assert.deepStrictEqual(result, [
      { name: 'Living Room Temp', data: { hc3DeviceId: '42' } },
      { name: 'Bedroom Temp', data: { hc3DeviceId: '44' } },
    ]);

    const motion = await app.getDevicesForDriver('motion-sensor');
    assert.deepStrictEqual(motion, [
      { name: 'Hallway Motion', data: { hc3DeviceId: '43' } },
    ]);

    const locks = await app.getDevicesForDriver('lock');
    assert.deepStrictEqual(locks, []);
  });

  it('returns an empty list when the API response is not an array', async () => {
    const app = createApp();
    app.getDevices = async () => ({ error: 'unexpected' });
    assert.deepStrictEqual(await app.getDevicesForDriver('switch'), []);
  });
});

describe('handleRefreshStates routing', () => {
  function createRoutingFixture() {
    const updates = [];
    const events = [];
    const fakeDevice = {
      getData: () => ({ hc3DeviceId: '42' }),
      handleStateUpdate: async (change) => updates.push(change),
      handleEvent: async (event) => events.push(event),
    };
    const otherDevice = {
      getData: () => ({ hc3DeviceId: '99' }),
      handleStateUpdate: async (change) => updates.push(change),
    };
    const app = createApp({
      drivers: {
        'temperature-sensor': { getDevices: () => [fakeDevice] },
        'motion-sensor': { getDevices: () => [otherDevice] },
      },
    });
    app.lastPoll = 0;
    return { app, updates, events };
  }

  it('routes changes and events to the paired device and tracks lastPoll', async () => {
    const { app, updates, events } = createRoutingFixture();

    await app.handleRefreshStates({
      status: 'OK',
      last: 123456,
      changes: [
        { id: 42, value: 22.5 },
        { id: 999, value: true }, // not paired → ignored
      ],
      events: [
        { type: 'CentralSceneEvent', data: { deviceId: 42, keyId: 1, keyAttribute: 'Pressed' } },
        { type: 'CentralSceneEvent', data: { deviceId: 555, keyId: 2 } }, // not paired → ignored
      ],
    });

    assert.strictEqual(app.lastPoll, 123456);
    assert.deepStrictEqual(updates, [{ id: 42, value: 22.5 }]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'CentralSceneEvent');
  });

  it('tolerates malformed responses', async () => {
    const { app } = createRoutingFixture();
    await app.handleRefreshStates(null);
    await app.handleRefreshStates({});
    await app.handleRefreshStates({ changes: 'not-an-array', events: [{}] });
    assert.strictEqual(app.lastPoll, 0);
  });

  it('logs but does not throw when a device handler fails', async () => {
    const failingDevice = {
      getData: () => ({ hc3DeviceId: '7' }),
      handleStateUpdate: async () => {
        throw new Error('boom');
      },
    };
    const app = createApp({
      drivers: { switch: { getDevices: () => [failingDevice] } },
    });

    await app.handleRefreshStates({ last: 5, changes: [{ id: 7, value: true }] });
    assert.strictEqual(app.lastPoll, 5);
  });
});

describe('HC3 HTTP integration (mock server)', () => {
  const USERNAME = 'admin';
  const PASSWORD = 'secret';
  const EXPECTED_AUTH = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;

  const INFO_RESPONSE = {
    serialNumber: 'HC3-0000001',
    platform: 'HC3',
    hcName: 'My Home Center',
    mac: '00:22:4d:aa:bb:cc',
    zwaveVersion: '6.07',
    currentVersion: { version: '5.150.22', type: 'stable' },
  };

  const DEVICES_RESPONSE = [
    {
      id: 42, name: 'Living Room Temp', type: 'com.fibaro.temperatureSensor', properties: { value: 22.5 },
    },
    {
      id: 43, name: 'Hallway Motion', type: 'com.fibaro.motionSensor', properties: { value: false },
    },
    {
      id: 50, name: 'Kitchen Dimmer', type: 'com.fibaro.multilevelSwitch', properties: { value: 50 },
    },
  ];

  let server;
  let port;
  const receivedRequests = [];

  function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(body);
  }

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      receivedRequests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.authorization,
        connection: req.headers.connection,
      });

      // Endpoint that never responds (for timeout testing)
      if (url.pathname === '/api/slow') {
        return;
      }

      // All other endpoints require correct Basic auth
      if (req.headers.authorization !== EXPECTED_AUTH) {
        sendJson(res, 401, { message: 'Unauthorized' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/settings/info') {
        sendJson(res, 200, INFO_RESPONSE);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/devices') {
        sendJson(res, 200, DEVICES_RESPONSE);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/refreshStates') {
        sendJson(res, 200, {
          status: 'OK',
          last: 777,
          timestamp: 1754800000,
          changes: [],
          events: [],
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/devices/50/action/setValue') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          receivedRequests[receivedRequests.length - 1].body = body;
          sendJson(res, 200, {});
        });
        return;
      }

      sendJson(res, 404, { message: 'Not found' });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => server.close());

  function createConfiguredApp(settingsOverride = {}) {
    const app = createApp({
      settings: {
        hc3_ip: `127.0.0.1:${port}`,
        hc3_username: USERNAME,
        hc3_password: PASSWORD,
        ...settingsOverride,
      },
    });
    app.loadSettings();
    return app;
  }

  it('makeRequest performs an authenticated GET and parses JSON', async () => {
    const app = createConfiguredApp();
    const info = await app.getSystemInfo();
    assert.deepStrictEqual(info, INFO_RESPONSE);

    const lastRequest = receivedRequests[receivedRequests.length - 1];
    assert.strictEqual(lastRequest.authorization, EXPECTED_AUTH);
    assert.strictEqual(lastRequest.path, '/api/settings/info');
  });

  it('requests disable HTTP keep-alive (fresh connection per request)', async () => {
    const app = createConfiguredApp();
    receivedRequests.length = 0;
    await app.getSystemInfo();
    await app.getSystemInfo();

    assert.strictEqual(receivedRequests.length, 2);
    for (const request of receivedRequests) {
      assert.strictEqual(request.connection, 'close');
    }
  });

  it('makeRequest rejects with status info on 401', async () => {
    const app = createConfiguredApp({ hc3_password: 'wrong' });
    await assert.rejects(() => app.getSystemInfo(), /HC3 API error: 401/);
  });

  it('makeRequest rejects on unreachable host', async () => {
    const app = createConfiguredApp({ hc3_ip: '127.0.0.1:1' }); // port 1 = closed
    await assert.rejects(() => app.getSystemInfo(), /HTTP request to HC3 failed/);
  });

  it('makeRequest times out when the server never responds', async () => {
    const app = createConfiguredApp();
    app.requestTimeoutMs = 150;
    await assert.rejects(() => app.makeRequest('/slow'), /timeout/i);
  });

  it('sendDeviceAction posts the action body to the HC3', async () => {
    const app = createConfiguredApp();
    app.version = 'test';
    await app.sendDeviceAction(50, 'setValue', [75]);

    const lastRequest = receivedRequests[receivedRequests.length - 1];
    assert.strictEqual(lastRequest.method, 'POST');
    assert.strictEqual(lastRequest.path, '/api/devices/50/action/setValue');
    assert.deepStrictEqual(JSON.parse(lastRequest.body), { args: [75] });
  });

  it('testConnection returns HC3 info and device count on success', async () => {
    const app = createConfiguredApp();
    app.version = 'test';
    const result = await app.testConnection();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.info.hcName, 'My Home Center');
    assert.strictEqual(result.info.platform, 'HC3');
    assert.strictEqual(result.info.serialNumber, 'HC3-0000001');
    assert.strictEqual(result.info.firmwareVersion, '5.150.22');
    assert.strictEqual(result.info.deviceCount, 3);
  });

  it('testConnection fails gracefully with wrong credentials', async () => {
    const app = createConfiguredApp({ hc3_password: 'wrong' });
    app.version = 'test';
    const result = await app.testConnection();

    assert.strictEqual(result.success, false);
    assert.match(result.error, /401/);
  });

  it('testConnection fails gracefully when not configured', async () => {
    const app = createApp();
    app.loadSettings();
    const result = await app.testConnection();

    assert.strictEqual(result.success, false);
    assert.match(result.error, /not configured/);
  });

  it('pollRefreshStates fetches states and advances lastPoll', async () => {
    const app = createConfiguredApp();
    app.version = 'test';
    app.lastPoll = 0;
    app.consecutivePollFailures = 0;
    app.pollingUpdateRunning = false;
    app.pollerActive = false; // prevent automatic rescheduling during the test

    assert.strictEqual(app.lastPoll, 0);
    await app.pollRefreshStates();
    assert.strictEqual(app.lastPoll, 777);

    // Second poll must send the updated last timestamp
    receivedRequests.length = 0;
    await app.pollRefreshStates();
    const lastRequest = receivedRequests[receivedRequests.length - 1];
    assert.strictEqual(lastRequest.path, '/api/refreshStates');
    assert.strictEqual(lastRequest.query.last, '777');
  });

  it('pollRefreshStates never throws when HC3 is unreachable', async () => {
    const app = createConfiguredApp({ hc3_ip: '127.0.0.1:1' });
    app.version = 'test';
    app.lastPoll = 0;
    app.consecutivePollFailures = 0;
    app.pollingUpdateRunning = false;
    app.pollerActive = false;

    await app.pollRefreshStates();
    assert.strictEqual(app.consecutivePollFailures, 1);

    await app.pollRefreshStates();
    assert.strictEqual(app.consecutivePollFailures, 2);
  });

  it('re-polls almost immediately when healthy (long-poll is the rate limiter)', async () => {
    const app = createConfiguredApp();
    app.version = 'test';
    app.lastPoll = 0;
    app.consecutivePollFailures = 0;
    app.pollingUpdateRunning = false;
    app.pollerActive = true;

    const delays = [];
    app.schedulePoll = (ms) => {
      delays.push(ms);
    };
    await app.pollRefreshStates();
    assert.deepStrictEqual(delays, [250]);
  });

  it('backs off to a 60s retry delay after a poll failure', async () => {
    const app = createConfiguredApp({ hc3_ip: '127.0.0.1:1' });
    app.version = 'test';
    app.lastPoll = 0;
    app.consecutivePollFailures = 0;
    app.pollingUpdateRunning = false;
    app.pollerActive = true;

    const delays = [];
    app.schedulePoll = (ms) => {
      delays.push(ms);
    };
    await app.pollRefreshStates();
    assert.deepStrictEqual(delays, [60000]);
  });

  it('stopRefreshStatesPoller aborts an in-flight long-poll without counting a failure', async () => {
    const app = createConfiguredApp();
    app.version = 'test';
    app.lastPoll = 0;
    app.consecutivePollFailures = 0;
    app.pollingUpdateRunning = false;
    app._trackedRequests = {};
    app.pollerActive = true;

    // Route the poll to the mock server's never-responding endpoint
    const originalMakeRequest = app.makeRequest.bind(app);
    app.makeRequest = (endpoint, options) => {
      if (endpoint === '/refreshStates') {
        return originalMakeRequest('/slow', options);
      }
      return originalMakeRequest(endpoint, options);
    };

    const delays = [];
    app.schedulePoll = (ms) => {
      delays.push(ms);
    };

    const pollPromise = app.pollRefreshStates();
    // eslint-disable-next-line homey-app/global-timers
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the request start
    app.stopRefreshStatesPoller(); // must abort the in-flight request
    await pollPromise; // error is caught internally

    assert.strictEqual(app.consecutivePollFailures, 0, 'aborted poll is not counted as a failure');
    assert.deepStrictEqual(delays, [], 'no follow-up poll scheduled after stop');
  });
});

describe('device list cache', () => {
  function createCacheFixture({ fetchResult = [], fetchError = null, delay = 0 } = {}) {
    const app = createApp();
    let calls = 0;
    app.makeRequest = async () => {
      calls += 1;
      if (delay) {
        // eslint-disable-next-line homey-app/global-timers
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (fetchError) throw fetchError;
      return fetchResult;
    };
    return { app, getCalls: () => calls };
  }

  it('serves the cached list within the TTL (single fetch)', async () => {
    const { app, getCalls } = createCacheFixture({ fetchResult: [{ id: 1 }] });
    await app.getDevices();
    await app.getDevices();
    assert.strictEqual(getCalls(), 1);
  });

  it('refetches after the TTL expires', async () => {
    const { app, getCalls } = createCacheFixture({ fetchResult: [] });
    await app.getDevices();
    app.devicesCache.fetchedAt = Date.now() - 31000;
    await app.getDevices();
    assert.strictEqual(getCalls(), 2);
  });

  it('forceRefresh bypasses the cache', async () => {
    const { app, getCalls } = createCacheFixture({ fetchResult: [] });
    await app.getDevices();
    await app.getDevices({ forceRefresh: true });
    assert.strictEqual(getCalls(), 2);
  });

  it('deduplicates concurrent fetches', async () => {
    const { app, getCalls } = createCacheFixture({ fetchResult: [], delay: 20 });
    await Promise.all([app.getDevices(), app.getDevices(), app.getDevices()]);
    assert.strictEqual(getCalls(), 1);
  });

  it('serves the stale cache when a refetch fails', async () => {
    const { app } = createCacheFixture({ fetchResult: [{ id: 7 }] });
    const first = await app.getDevices();
    assert.deepStrictEqual(first, [{ id: 7 }]);

    app.devicesCache.fetchedAt = Date.now() - 31000; // expire the cache
    app.makeRequest = async () => {
      throw new Error('Request timeout after 30000ms');
    };
    const second = await app.getDevices();
    assert.deepStrictEqual(second, [{ id: 7 }], 'stale cache served on fetch failure');
  });

  it('throws when the fetch fails and no cache exists', async () => {
    const { app } = createCacheFixture({ fetchError: new Error('Request timeout') });
    await assert.rejects(() => app.getDevices(), /timeout/);
  });
});
