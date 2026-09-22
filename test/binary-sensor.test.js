'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const BinarySensorDriver = require('../drivers/binary-sensor/driver');
const BinarySensorDevice = require('../drivers/binary-sensor/device');
const ContactSensorDevice = require('../drivers/contact-sensor/device');

function createDevice({ hc3DeviceId = '238', deviceInfo = null, getDeviceInfoError = null } = {}) {
  const device = new BinarySensorDevice();
  device._data = { hc3DeviceId };
  device._name = 'Garage Laser Beam';

  const app = createApp();
  app.getDeviceInfo = async () => {
    if (getDeviceInfoError) throw getDeviceInfoError;
    return deviceInfo;
  };
  device.homey = { app };
  return device;
}

describe('binary-sensor device', () => {
  it('maps HC3 value=true (sensor active) to alarm_generic=true', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), true);
  });

  it('maps HC3 value=false (sensor inactive) to alarm_generic=false', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: true });
    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), false);
  });

  it('tolerates string values from the HC3', async () => {
    const device = createDevice();
    await device.handleStateUpdate({ value: 'true' });
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), true);
    await device.handleStateUpdate({ value: 'false' });
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), false);
  });

  it('ignores missing values without throwing', async () => {
    const device = createDevice();
    await device.handleStateUpdate({});
    await device.handleStateUpdate({ value: null });
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), null);
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
      deviceInfo: { id: 238, properties: { value: true, batteryLevel: 78 } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('alarm_generic'), true);
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

describe('binary-sensor driver pairing', () => {
  it('list_devices returns HC3 binary sensor devices only', async () => {
    const driver = new BinarySensorDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 238, name: 'Garage Laser Beam', type: 'com.fibaro.binarySensor', properties: {},
      },
      {
        id: 239, name: 'Gate Beam', type: 'com.fibaro.binarySensor', parentId: 224, properties: {},
      },
      {
        id: 292, name: 'Main Door', type: 'com.fibaro.doorWindowSensor', properties: {},
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
      { name: 'Garage Laser Beam', data: { hc3DeviceId: '238' } },
      { name: 'Gate Beam', data: { hc3DeviceId: '239' } },
    ]);
  });

  it('contact-sensor pairing lists binary sensors too (dual-pairing alias)', async () => {
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 238, name: 'Garage Laser Beam', type: 'com.fibaro.binarySensor', properties: {},
      },
    ];

    const contactList = await app.getDevicesForDriver('contact-sensor');
    assert.deepStrictEqual(contactList, [
      { name: 'Garage Laser Beam', data: { hc3DeviceId: '238' } },
    ]);

    // ...while the binary-sensor driver keeps its own list
    const binaryList = await app.getDevicesForDriver('binary-sensor');
    assert.deepStrictEqual(binaryList, [
      { name: 'Garage Laser Beam', data: { hc3DeviceId: '238' } },
    ]);
  });
});

describe('binary sensor paired as a contact sensor', () => {
  it('maps HC3 value to alarm_contact (polarity: true = beam breached = alarm)', async () => {
    // A binary sensor paired through the contact-sensor driver gets a
    // ContactSensorDevice; state routing is by HC3 id (findPairedDevices),
    // so the same value property drives alarm_contact.
    const device = new ContactSensorDevice();
    device._data = { hc3DeviceId: '238' };
    device._name = 'Garage Laser Beam';
    device.homey = { app: createApp() };

    await device.handleStateUpdate({ value: true });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);

    await device.handleStateUpdate({ value: false });
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), false);
  });
});
