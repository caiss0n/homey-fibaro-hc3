'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const TemperatureSensorDriver = require('../drivers/temperature-sensor/driver');
const TemperatureSensorDevice = require('../drivers/temperature-sensor/device');

function createDevice({ hc3DeviceId = '42', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new TemperatureSensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Living Room Temp';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('temperature-sensor device', () => {
  it('maps HC3 value to measure_temperature (Celsius passthrough)', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 22.5, unit: 'C' });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 22.5);
  });

  it('converts Fahrenheit to Celsius when the HC3 reports unit F', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 68, unit: 'F' });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 20);
  });

  it('remembers the unit for later value-only refreshStates changes', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 68, unit: 'F' });
    // refreshStates changes often only contain the changed property
    await device.handleStateUpdate({ value: 71.6 });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 22);
  });

  it('handles string values from the HC3', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: '21.3' });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 21.3);
  });

  it('ignores missing or non-numeric values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'not-a-number' });
    await device.handleStateUpdate({ value: null });
    await device.handleStateUpdate({});
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), null);
  });

  it('does not write the capability when the value is unchanged', async () => {
    const device = createDevice();
    let writes = 0;
    const originalSet = device.setCapabilityValue.bind(device);
    device.setCapabilityValue = async (id, value) => {
      writes += 1;
      return originalSet(id, value);
    };

    await device.handleStateUpdate({ value: 22.5 });
    await device.handleStateUpdate({ value: 22.5 });
    assert.strictEqual(writes, 1);
  });

  it('updateState fetches the initial state from the HC3', async () => {
    const device = createDevice({
      deviceInfo: { id: 42, properties: { value: 19.8, unit: 'C' } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 19.8);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('updateState marks the device unavailable when the HC3 is unreachable', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('connection refused') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);
    assert.match(device._unavailableReason, /connection refused/);
  });

  it('recovers to available when a state update arrives after an outage', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('connection refused') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);

    await device.handleStateUpdate({ value: 23.1 });
    assert.strictEqual(device.getAvailable(), true);
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 23.1);
  });
});

describe('temperature-sensor driver pairing', () => {
  function createPairingFixture({ devices = [], throwError = null } = {}) {
    const driver = new TemperatureSensorDriver();
    const app = createApp();
    app.getDevicesForDriver = async (driverId) => {
      assert.strictEqual(driverId, 'temperature-sensor');
      if (throwError) throw throwError;
      return devices;
    };
    driver.homey = { app };

    const handlers = {};
    const session = {
      setHandler: (name, fn) => {
        handlers[name] = fn;
      },
    };
    return { driver, session, handlers };
  }

  it('onPair registers a list_devices handler returning HC3 devices', async () => {
    const devices = [{ name: 'Living Room Temp', data: { hc3DeviceId: '42' } }];
    const { driver, session, handlers } = createPairingFixture({ devices });

    await driver.onPair(session);
    assert.strictEqual(typeof handlers.list_devices, 'function');

    const result = await handlers.list_devices();
    assert.deepStrictEqual(result, devices);
  });

  it('list_devices throws a friendly error when the HC3 is unreachable', async () => {
    const { driver, session, handlers } = createPairingFixture({
      throwError: new Error('connection refused'),
    });

    await driver.onPair(session);
    await assert.rejects(() => handlers.list_devices(), /Failed to load devices from HC3/);
  });
});
