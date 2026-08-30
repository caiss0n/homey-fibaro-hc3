'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const LockDriver = require('../drivers/lock/driver');
const LockDevice = require('../drivers/lock/device');

function createDevice({ hc3DeviceId = '400', deviceInfo = null } = {}) {
  const device = new LockDevice();
  device._data = { hc3DeviceId };
  device._name = 'Front Door Lock';

  const sentCommands = [];
  const app = createApp();
  app.getDeviceInfo = async () => deviceInfo;
  app.sendDeviceAction = async (id, action, args = []) => {
    sentCommands.push({ id, action, args });
    return {};
  };
  device.homey = { app };
  return { device, sentCommands };
}

describe('lock device', () => {
  it('registers the locked listener and fetches initial state on init', async () => {
    const { device } = createDevice({ deviceInfo: { id: 400, properties: { value: true } } });
    await device.onInit();
    assert.strictEqual(typeof device._capabilityListeners.locked, 'function');
    assert.strictEqual(device.getCapabilityValue('locked'), true);
  });

  it('maps HC3 value to locked (true=secured, false=unsecured)', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('locked'), true);

    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('locked'), false);

    await device.handleStateUpdate({ value: 'true' });
    assert.strictEqual(device.getCapabilityValue('locked'), true);
  });

  it('sends secure/unsecure with [0] args via the locked listener', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityLocked(true);
    await device.onCapabilityLocked(false);
    assert.deepStrictEqual(sentCommands, [
      { id: '400', action: 'secure', args: [0] },
      { id: '400', action: 'unsecure', args: [0] },
    ]);
  });

  it('throws a user-friendly error when the command fails', async () => {
    const { device } = createDevice();
    device.homey.app.sendDeviceAction = async () => {
      throw new Error('HC3 API error: 503');
    };
    await assert.rejects(() => device.onCapabilityLocked(true), /Failed to lock the device/);
    await assert.rejects(() => device.onCapabilityLocked(false), /Failed to unlock the device/);
  });

  it('ignores refreshStates updates during the command cooldown', async () => {
    const { device } = createDevice({ deviceInfo: { id: 400, properties: { value: true } } });
    await device.onInit();
    assert.strictEqual(device.getCapabilityValue('locked'), true);

    await device.onCapabilityLocked(false); // unlock command → cooldown starts
    await device.handleStateUpdate({ value: true }); // stale "locked" report
    assert.strictEqual(device.getCapabilityValue('locked'), true, 'stale update ignored during cooldown');

    device.commandCooldownUntil = 0;
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('locked'), false);
  });

  it('adds measure_battery dynamically when the HC3 reports batteryLevel', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: true, batteryLevel: 66 });
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 66);
  });
});

describe('lock driver pairing', () => {
  it('list_devices returns locks (incl. doorLock type and secure-action fallback)', async () => {
    const driver = new LockDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 400, name: 'Front Door Lock', type: 'com.fibaro.lock', properties: {},
      },
      {
        id: 401, name: 'Back Door Lock', type: 'com.fibaro.doorLock', properties: {},
      },
      {
        id: 402, name: 'Vendor Lock', type: 'com.fibaro.vendorLock', properties: {}, actions: { secure: {}, unsecure: {} },
      },
      {
        id: 403, name: 'Office Light', type: 'com.fibaro.binarySwitch', properties: {},
      },
    ];
    driver.homey = { app };

    const handlers = {};
    await driver.onPair({
      setHandler: (name, fn) => {
        handlers[name] = fn;
      },
    });

    const result = await handlers.list_devices();
    assert.deepStrictEqual(result, [
      { name: 'Front Door Lock', data: { hc3DeviceId: '400' } },
      { name: 'Back Door Lock', data: { hc3DeviceId: '401' } },
      { name: 'Vendor Lock', data: { hc3DeviceId: '402' } },
    ]);
  });
});
