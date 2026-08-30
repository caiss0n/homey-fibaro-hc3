'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const MotionSensorDriver = require('../drivers/motion-sensor/driver');
const MotionSensorDevice = require('../drivers/motion-sensor/device');

function createDevice({ hc3DeviceId = '43', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new MotionSensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Hallway Motion';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('motion-sensor device', () => {
  it('maps HC3 value=true to alarm_motion=true', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('alarm_motion'), true);
  });

  it('maps HC3 value=false to alarm_motion=false', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('alarm_motion'), false);
  });

  it('tolerates string values from the HC3', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'true' });
    assert.strictEqual(device.getCapabilityValue('alarm_motion'), true);
  });

  it('ignores missing values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({});
    await device.handleStateUpdate({ value: null });
    assert.strictEqual(device.getCapabilityValue('alarm_motion'), null);
  });

  it('does not write the capability when the value is unchanged', async () => {
    const device = createDevice();
    let writes = 0;
    const originalSet = device.setCapabilityValue.bind(device);
    device.setCapabilityValue = async (id, value) => {
      writes += 1;
      return originalSet(id, value);
    };

    await device.handleStateUpdate({ value: true });
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(writes, 1);
  });

  it('adds measure_battery dynamically when the HC3 reports batteryLevel', async () => {
    const device = createDevice();
    assert.strictEqual(device.hasCapability('measure_battery'), false);

    await device.handleStateUpdate({ value: false, batteryLevel: 87 });
    assert.strictEqual(device.hasCapability('measure_battery'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 87);
  });

  it('never adds measure_battery for mains-powered devices (no batteryLevel)', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.hasCapability('measure_battery'), false);
  });

  it('clamps out-of-range battery levels', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ batteryLevel: 120 });
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 100);
  });

  it('updateState fetches the initial state from the HC3', async () => {
    const device = createDevice({
      deviceInfo: { id: 43, properties: { value: true, batteryLevel: 64 } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('alarm_motion'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 64);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('marks the device unavailable when the HC3 is unreachable, recovers on update', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('timeout') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);
    assert.match(device._unavailableReason, /timeout/);

    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getAvailable(), true);
  });
});

describe('motion-sensor driver pairing', () => {
  it('onPair registers a list_devices handler returning HC3 devices', async () => {
    const devices = [{ name: 'Hallway Motion', data: { hc3DeviceId: '43' } }];
    const driver = new MotionSensorDriver();
    const app = createApp();
    app.getDevicesForDriver = async (driverId) => {
      assert.strictEqual(driverId, 'motion-sensor');
      return devices;
    };
    driver.homey = { app };

    const handlers = {};
    const session = {
      setHandler: (name, fn) => {
        handlers[name] = fn;
      },
    };

    await driver.onPair(session);
    const result = await handlers.list_devices();
    assert.deepStrictEqual(result, devices);
  });
});
