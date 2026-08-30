'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const DimmerDriver = require('../drivers/dimmer/driver');
const DimmerDevice = require('../drivers/dimmer/device');

function createDevice({ hc3DeviceId = '60', deviceInfo = null } = {}) {
  const device = new DimmerDevice();
  device._data = { hc3DeviceId };
  device._name = 'Corridor Light';

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

describe('dimmer device', () => {
  it('registers onoff and dim listeners and fetches initial state on init', async () => {
    const { device } = createDevice({ deviceInfo: { id: 60, properties: { value: 75 } } });
    await device.onInit();
    assert.strictEqual(typeof device._capabilityListeners.onoff, 'function');
    assert.strictEqual(typeof device._capabilityListeners.dim, 'function');
    assert.strictEqual(device.getCapabilityValue('dim'), 0.75);
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
  });

  it('maps HC3 value (0-100) to dim (0-1) and onoff', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: 30 });
    assert.strictEqual(device.getCapabilityValue('dim'), 0.3);
    assert.strictEqual(device.getCapabilityValue('onoff'), true);

    await device.handleStateUpdate({ value: 0 });
    assert.strictEqual(device.getCapabilityValue('dim'), 0);
    assert.strictEqual(device.getCapabilityValue('onoff'), false);
  });

  it('handles string values and clamps out-of-range levels', async () => {
    const { device } = createDevice();
    await device.handleStateUpdate({ value: '50' });
    assert.strictEqual(device.getCapabilityValue('dim'), 0.5);

    await device.handleStateUpdate({ value: 120 });
    assert.strictEqual(device.getCapabilityValue('dim'), 1);
  });

  it('sends setValue with 0-100 when the dim slider changes', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityDim(0.4);
    assert.deepStrictEqual(sentCommands, [{ id: '60', action: 'setValue', args: [40] }]);
    assert.strictEqual(device.getCapabilityValue('onoff'), true);
  });

  it('sends setValue 0 and clears onoff when dimmed to zero', async () => {
    const { device, sentCommands } = createDevice({ deviceInfo: { id: 60, properties: { value: 80 } } });
    await device.onInit();

    await device.onCapabilityDim(0);
    assert.deepStrictEqual(sentCommands, [{ id: '60', action: 'setValue', args: [0] }]);
    assert.strictEqual(device.getCapabilityValue('onoff'), false);
  });

  it('sends turnOn/turnOff via the onoff listener', async () => {
    const { device, sentCommands } = createDevice();
    await device.onCapabilityOnoff(true);
    await device.onCapabilityOnoff(false);
    assert.deepStrictEqual(sentCommands, [
      { id: '60', action: 'turnOn', args: [] },
      { id: '60', action: 'turnOff', args: [] },
    ]);
  });

  it('throws a user-friendly error when a command fails', async () => {
    const { device } = createDevice();
    device.homey.app.sendDeviceAction = async () => {
      throw new Error('HC3 API error: 503');
    };
    await assert.rejects(() => device.onCapabilityDim(0.5), /Failed to set the dim level/);
    await assert.rejects(() => device.onCapabilityOnoff(true), /Failed to control the dimmer/);
  });

  it('ignores refreshStates updates during the command cooldown (slider flicker prevention)', async () => {
    const { device } = createDevice({ deviceInfo: { id: 60, properties: { value: 10 } } });
    await device.onInit();
    assert.strictEqual(device.getCapabilityValue('dim'), 0.1);

    // User drags the slider to 60% → cooldown starts; transition values must be ignored
    await device.onCapabilityDim(0.6);
    await device.handleStateUpdate({ value: 10 }); // stale in-flight poll
    await device.handleStateUpdate({ value: 35 }); // HC3 mid-transition
    assert.strictEqual(device.getCapabilityValue('dim'), 0.1, 'stale/transition values ignored during cooldown');

    // After the cooldown the confirmed HC3 state is applied
    device.commandCooldownUntil = 0;
    await device.handleStateUpdate({ value: 60 });
    assert.strictEqual(device.getCapabilityValue('dim'), 0.6);
  });
});

describe('dimmer driver pairing', () => {
  it('list_devices returns dimmers', async () => {
    const driver = new DimmerDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 60, name: 'Corridor Light', type: 'com.fibaro.multilevelSwitch', properties: {},
      },
      {
        id: 61, name: 'Hallway Motion', type: 'com.fibaro.motionSensor', properties: {},
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
      { name: 'Corridor Light', data: { hc3DeviceId: '60' } },
    ]);
  });
});
