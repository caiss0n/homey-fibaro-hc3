'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const HumiditySensorDriver = require('../drivers/humidity-sensor/driver');
const HumiditySensorDevice = require('../drivers/humidity-sensor/device');

function createDevice({ hc3DeviceId = '245', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new HumiditySensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Master Bath Humidity';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('humidity-sensor device', () => {
  it('maps HC3 value (%) to measure_humidity', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 58 });
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), 58);
  });

  it('handles string values', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: '62.5' });
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), 62.5);
  });

  it('clamps values to 0-100%', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 110 });
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), 100);

    await device.handleStateUpdate({ value: -3 });
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), 0);
  });

  it('ignores missing or non-numeric values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'not-a-number' });
    await device.handleStateUpdate({ value: null });
    await device.handleStateUpdate({});
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), null);
  });

  it('adds measure_battery dynamically when the HC3 reports batteryLevel', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 55, batteryLevel: 88 });
    assert.strictEqual(device.hasCapability('measure_battery'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 88);
  });

  it('updateState fetches the initial state from the HC3', async () => {
    const device = createDevice({
      deviceInfo: { id: 245, properties: { value: 61, unit: '%' } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('measure_humidity'), 61);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('marks the device unavailable when the HC3 is unreachable, recovers on update', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('timeout') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);

    await device.handleStateUpdate({ value: 47 });
    assert.strictEqual(device.getAvailable(), true);
  });
});

describe('humidity-sensor driver pairing', () => {
  it('list_devices returns humidity sensors', async () => {
    const driver = new HumiditySensorDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 245, name: 'Master Bath Humidity', type: 'com.fibaro.humiditySensor', properties: {},
      },
      {
        id: 246,
        name: 'Multilevel Humidity',
        type: 'com.fibaro.multilevelSensor',
        properties: { deviceRole: 'HumiditySensor' },
      },
      {
        id: 247, name: 'Living Room Temp', type: 'com.fibaro.temperatureSensor', properties: {},
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
      { name: 'Master Bath Humidity', data: { hc3DeviceId: '245' } },
      { name: 'Multilevel Humidity', data: { hc3DeviceId: '246' } },
    ]);
  });
});
