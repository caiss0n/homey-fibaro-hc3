'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const WindowCoveringDriver = require('../drivers/window-covering/driver');
const WindowCoveringDevice = require('../drivers/window-covering/device');

function createDevice({ hc3DeviceId = '227', deviceInfo = null } = {}) {
  const device = new WindowCoveringDevice();
  device._data = { hc3DeviceId };
  device._name = 'Bedroom Blinds';

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

describe('window-covering device', () => {
  it('registers listeners and fetches initial state on init', async () => {
    const { device } = createDevice({ deviceInfo: { id: 227, properties: { value: 50 } } });
    await device.onInit();
    assert.strictEqual(typeof device._capabilityListeners.windowcoverings_state, 'function');
    assert.strictEqual(typeof device._capabilityListeners.windowcoverings_set, 'function');
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0.5);
  });

  it('maps HC3 value (0-100) to windowcoverings_set (0-1)', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: 0 });
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0);

    await device.handleStateUpdate({ value: 100 });
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 1);

    await device.handleStateUpdate({ value: '75' });
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0.75);
  });

  it('clamps out-of-range positions', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: 130 });
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 1);
  });

  it('sends open/close/stop for windowcoverings_state up/down/idle', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityState('up');
    await device.onCapabilityState('down');
    await device.onCapabilityState('idle');
    assert.deepStrictEqual(sentCommands, [
      { id: '227', action: 'open', args: [] },
      { id: '227', action: 'close', args: [] },
      { id: '227', action: 'stop', args: [] },
    ]);
  });

  it('rejects an unsupported state value', async () => {
    const { device } = createDevice();
    await assert.rejects(() => device.onCapabilityState('sideways'), /Unsupported windowcoverings_state/);
  });

  it('sends setValue with 0-100 for windowcoverings_set', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilitySet(0.4);
    assert.deepStrictEqual(sentCommands, [{ id: '227', action: 'setValue', args: [40] }]);
  });

  it('throws a user-friendly error when a command fails', async () => {
    const { device } = createDevice();
    device.homey.app.sendDeviceAction = async () => {
      throw new Error('HC3 API error: 503');
    };
    await assert.rejects(() => device.onCapabilityState('up'), /Failed to control the window covering/);
    await assert.rejects(() => device.onCapabilitySet(0.5), /Failed to set the position/);
  });

  it('ignores refreshStates updates during the command cooldown (slider flicker prevention)', async () => {
    const { device } = createDevice({ deviceInfo: { id: 227, properties: { value: 10 } } });
    await device.onInit();
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0.1);

    // User sets 60% → cooldown starts; in-flight/transition values must be ignored
    await device.onCapabilitySet(0.6);
    await device.handleStateUpdate({ value: 10 }); // stale
    await device.handleStateUpdate({ value: 35 }); // mid-transition
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0.1);

    device.commandCooldownUntil = 0; // cooldown expired
    await device.handleStateUpdate({ value: 60 });
    assert.strictEqual(device.getCapabilityValue('windowcoverings_set'), 0.6);
  });
});

describe('window-covering driver pairing', () => {
  it('list_devices returns roller shutters but not garage-configured ones', async () => {
    const driver = new WindowCoveringDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 220, name: 'Bedroom Blinds', type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 55 },
      },
      {
        id: 227, name: 'Garage Door', type: 'com.fibaro.rollerShutter', properties: { deviceControlType: 57 },
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
      { name: 'Bedroom Blinds', data: { hc3DeviceId: '220' } },
    ]);
  });
});
