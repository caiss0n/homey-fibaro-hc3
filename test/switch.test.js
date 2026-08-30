'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const SwitchDriver = require('../drivers/switch/driver');
const SwitchDevice = require('../drivers/switch/device');

function createDevice({ hc3DeviceId = '50', deviceInfo = null } = {}) {
  const device = new SwitchDevice();
  device._data = { hc3DeviceId };
  device._name = 'Office Light';

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

describe('switch device', () => {
  it('registers the onoff listener and fetches initial state on init', async () => {
    const { device } = createDevice({ deviceInfo: { id: 50, properties: { value: true } } });
    await device.onInit();
    assert.strictEqual(typeof device._capabilityListeners.onoff, 'function');
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
  });

  it('maps HC3 value to onoff', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('onoff'), false);
    await device.handleStateUpdate({ value: 'true' });
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
  });

  it('sends turnOn to the HC3 when toggled on', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityOnoff(true);
    assert.deepStrictEqual(sentCommands, [{ id: '50', action: 'turnOn', args: [] }]);
  });

  it('sends turnOff to the HC3 when toggled off', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityOnoff(false);
    assert.deepStrictEqual(sentCommands, [{ id: '50', action: 'turnOff', args: [] }]);
  });

  it('throws a user-friendly error when the command fails', async () => {
    const { device } = createDevice();
    device.homey.app.sendDeviceAction = async () => {
      throw new Error('HC3 API error: 503');
    };
    await assert.rejects(() => device.onCapabilityOnoff(true), /Failed to control the switch/);
  });

  it('ignores refreshStates updates during the command cooldown', async () => {
    const { device } = createDevice({ deviceInfo: { id: 50, properties: { value: false } } });
    await device.onInit();
    assert.strictEqual(device.getCapabilityValue('onoff'), false);

    // User toggles ON → cooldown starts; a stale poll saying "off" must be ignored
    await device.onCapabilityOnoff(true);
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('onoff'), false, 'stale update ignored during cooldown');

    // After the cooldown, updates flow again
    device.commandCooldownUntil = 0;
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
  });

  it('still updates the battery capability during the cooldown', async () => {
    const { device } = createDevice();
    device.commandCooldownUntil = Date.now() + 60000;
    await device.handleStateUpdate({ value: false, batteryLevel: 55 });
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 55);
  });
});

describe('switch driver pairing', () => {
  it('list_devices returns switches with a light class hint for lighting controlTypes', async () => {
    const driver = new SwitchDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 50, name: 'office light', type: 'com.fibaro.binarySwitch', properties: { deviceControlType: 2 },
      },
      {
        id: 51, name: 'Wall Plug TV', type: 'com.fibaro.binarySwitch', properties: { deviceControlType: 1 },
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
      {
        name: 'office light',
        data: { hc3DeviceId: '50' },
        class: 'light',
        settings: { deviceClass: 'light' },
      },
      { name: 'Wall Plug TV', data: { hc3DeviceId: '51' } },
    ]);
  });
});

describe('switch device class configuration', () => {
  it('changes the class via onSettings when a valid class is chosen', async () => {
    const { device } = createDevice();
    assert.strictEqual(device.getClass(), 'socket');

    await device.onSettings({ newSettings: { deviceClass: 'heater' }, changedKeys: ['deviceClass'] });
    assert.strictEqual(device.getClass(), 'heater');
  });

  it('rejects an unsupported class', async () => {
    const { device } = createDevice();
    await assert.rejects(
      () => device.onSettings({ newSettings: { deviceClass: 'camera' }, changedKeys: ['deviceClass'] }),
      /Unsupported device class/,
    );
    assert.strictEqual(device.getClass(), 'socket', 'class unchanged after rejection');
  });

  it('ignores unrelated settings changes', async () => {
    const { device } = createDevice();
    await device.onSettings({ newSettings: { somethingElse: 1 }, changedKeys: ['somethingElse'] });
    assert.strictEqual(device.getClass(), 'socket');
  });

  it('applies the configured class on init (e.g. paired as light)', async () => {
    const { device } = createDevice({ deviceInfo: { id: 50, properties: { value: false } } });
    device._settings = { deviceClass: 'light' };

    await device.onInit();
    assert.strictEqual(device.getClass(), 'light');
  });

  it('does not call setClass on init when the configured class matches', async () => {
    const { device } = createDevice({ deviceInfo: { id: 50, properties: { value: false } } });
    device._settings = { deviceClass: 'socket' }; // stub default is already 'socket'

    let setClassCalls = 0;
    const originalSetClass = device.setClass.bind(device);
    device.setClass = async (cls) => {
      setClassCalls += 1;
      return originalSetClass(cls);
    };

    await device.onInit();
    assert.strictEqual(setClassCalls, 0);
  });
});
