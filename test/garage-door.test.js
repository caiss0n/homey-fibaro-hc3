'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const GarageDoorDriver = require('../drivers/garage-door/driver');
const GarageDoorDevice = require('../drivers/garage-door/device');

function createDevice({ hc3DeviceId = '227', deviceInfo = null } = {}) {
  const device = new GarageDoorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Garage Door';

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

describe('garage-door device', () => {
  it('registers the garagedoor_closed listener and fetches initial state on init', async () => {
    const { device } = createDevice({ deviceInfo: { id: 227, properties: { value: 0 } } });
    await device.onInit();
    assert.strictEqual(typeof device._capabilityListeners.garagedoor_closed, 'function');
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), true);
  });

  it('maps HC3 value to garagedoor_closed (0=closed, anything else=open)', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: 0 });
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), true);

    await device.handleStateUpdate({ value: 100 });
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), false);

    await device.handleStateUpdate({ value: 50 });
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), false);
  });

  it('normalizes the HC3 1/99 reporting quirk', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: 1 }); // quirk: 1 = fully closed
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), true);

    await device.handleStateUpdate({ value: 99 }); // quirk: 99 = fully open
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), false);
  });

  it('sends close/open via the garagedoor_closed listener', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityGarageDoorClosed(true);
    await device.onCapabilityGarageDoorClosed(false);
    assert.deepStrictEqual(sentCommands, [
      { id: '227', action: 'close', args: [] },
      { id: '227', action: 'open', args: [] },
    ]);
  });

  it('throws a user-friendly error when the command fails', async () => {
    const { device } = createDevice();
    device.homey.app.sendDeviceAction = async () => {
      throw new Error('HC3 API error: 503');
    };
    await assert.rejects(() => device.onCapabilityGarageDoorClosed(true), /Failed to control the garage door/);
  });

  it('uses a 20s command cooldown so mid-transit positions do not flip the toggle', async () => {
    const { device } = createDevice({ deviceInfo: { id: 227, properties: { value: 0 } } });
    await device.onInit();
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), true);

    const before = Date.now();
    await device.onCapabilityGarageDoorClosed(false); // open command → cooldown starts
    const cooldownRemaining = device.commandCooldownUntil - before;
    assert.ok(cooldownRemaining >= 19000 && cooldownRemaining <= 20000,
      `cooldown ≈20s, got ${cooldownRemaining}ms`);

    // Mid-transit position (door half open) must be ignored during cooldown
    await device.handleStateUpdate({ value: 50 });
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), true, 'mid-transit update ignored');

    // After the cooldown the confirmed state is applied
    device.commandCooldownUntil = 0;
    await device.handleStateUpdate({ value: 100 });
    assert.strictEqual(device.getCapabilityValue('garagedoor_closed'), false);
  });
});

describe('garage-door driver pairing', () => {
  it('list_devices returns barriers and garage/gate-configured shutters only', async () => {
    const driver = new GarageDoorDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 227, name: 'Garage Door', type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 57 },
      },
      {
        id: 300, name: 'Side Gate', type: 'com.fibaro.barrier', properties: {},
      },
      {
        id: 220, name: 'Bedroom Blinds', type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 55 },
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
      { name: 'Garage Door', data: { hc3DeviceId: '227' } },
      { name: 'Side Gate', data: { hc3DeviceId: '300' } },
    ]);
  });
});
