'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const ContactSensorDriver = require('../drivers/contact-sensor/driver');
const ContactSensorDevice = require('../drivers/contact-sensor/device');

function createDevice({ hc3DeviceId = '292', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new ContactSensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Main Door';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('contact-sensor device', () => {
  it('maps HC3 value=true (contact open) to alarm_contact=true', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
  });

  it('maps HC3 value=false (contact closed) to alarm_contact=false', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), false);
  });

  it('tolerates string values from the HC3', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'true' });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
    await device.handleStateUpdate({ value: 'false' });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), false);
  });

  it('ignores missing values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({});
    await device.handleStateUpdate({ value: null });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), null);
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

    await device.handleStateUpdate({ value: false, batteryLevel: 92 });
    assert.strictEqual(device.hasCapability('measure_battery'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 92);
  });

  it('updateState fetches the initial state from the HC3', async () => {
    const device = createDevice({
      deviceInfo: { id: 292, properties: { value: true, batteryLevel: 78 } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
    assert.strictEqual(device.getCapabilityValue('measure_battery'), 78);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('marks the device unavailable when the HC3 is unreachable, recovers on update', async () => {
    const device = createDevice({ getDeviceInfoError: new Error('timeout') });
    await device.updateState();
    assert.strictEqual(device.getAvailable(), false);

    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getAvailable(), true);
  });
});

describe('contact-sensor driver pairing', () => {
  it('list_devices returns all HC3 door/window sensor type variants', async () => {
    const driver = new ContactSensorDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 292, name: 'Main Door', type: 'com.fibaro.doorWindowSensor', properties: {},
      },
      {
        id: 293, name: 'Nabeeha Window', type: 'com.fibaro.doorSensor', properties: {},
      },
      {
        id: 294, name: 'TestUtils', type: 'com.fibaro.windowSensor', properties: {},
      },
      {
        id: 295, name: 'Plain Contact', type: 'com.fibaro.contactSensor', properties: {},
      },
      {
        id: 296, name: 'Hallway Motion', type: 'com.fibaro.motionSensor', properties: {},
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
      { name: 'Main Door', data: { hc3DeviceId: '292' } },
      { name: 'Nabeeha Window', data: { hc3DeviceId: '293' } },
      { name: 'TestUtils', data: { hc3DeviceId: '294' } },
      { name: 'Plain Contact', data: { hc3DeviceId: '295' } },
    ]);
  });
});
