'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const LightSensorDriver = require('../drivers/light-sensor/driver');
const LightSensorDevice = require('../drivers/light-sensor/device');

function createDevice({ hc3DeviceId = '240', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new LightSensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Lux Living 1';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('light-sensor device', () => {
  it('maps HC3 value (lux) to measure_luminance', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 350 });
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), 350);
  });

  it('handles string values and darkness (0 lux)', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: '812.5' });
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), 812.5);

    await device.handleStateUpdate({ value: 0 });
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), 0);
  });

  it('clamps negative values to 0', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: -5 });
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), 0);
  });

  it('ignores missing or non-numeric values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'not-a-number' });
    await device.handleStateUpdate({ value: null });
    await device.handleStateUpdate({});
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), null);
  });

  it('does not write the capability when the value is unchanged', async () => {
    const device = createDevice();
    let writes = 0;
    const originalSet = device.setCapabilityValue.bind(device);
    device.setCapabilityValue = async (id, value) => {
      writes += 1;
      return originalSet(id, value);
    };

    await device.handleStateUpdate({ value: 350 });
    await device.handleStateUpdate({ value: 350 });
    assert.strictEqual(writes, 1);
  });

  it('adds measure_battery dynamically when the HC3 reports batteryLevel', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 120, batteryLevel: 71 });
    assert.strictEqual(device.hasCapability('measure_battery'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 71);
  });

  it('updateState fetches the initial state from the HC3', async () => {
    const device = createDevice({
      deviceInfo: { id: 240, properties: { value: 640, unit: 'lux' } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('measure_luminance'), 640);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('marks the device unavailable when the HC3 is unreachable, recovers on update', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('timeout') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);

    await device.handleStateUpdate({ value: 200 });
    assert.strictEqual(device.getAvailable(), true);
  });
});

describe('light-sensor driver pairing', () => {
  it('list_devices returns light sensors', async () => {
    const driver = new LightSensorDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 240, name: 'Lux Living 1', type: 'com.fibaro.lightSensor', properties: {},
      },
      {
        id: 241, name: 'Hallway Motion', type: 'com.fibaro.motionSensor', properties: {},
      },
      {
        id: 242,
        name: 'Multilevel Lux',
        type: 'com.fibaro.multilevelSensor',
        properties: { deviceRole: 'LightSensor' },
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
      { name: 'Lux Living 1', data: { hc3DeviceId: '240' } },
      { name: 'Multilevel Lux', data: { hc3DeviceId: '242' } },
    ]);
  });
});
