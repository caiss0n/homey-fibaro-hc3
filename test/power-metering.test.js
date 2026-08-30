'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const SwitchDevice = require('../drivers/switch/device');
const ContactSensorDevice = require('../drivers/contact-sensor/device');

function createSwitchDevice({ hc3DeviceId = '32', deviceInfo = null } = {}) {
  const device = new SwitchDevice();
  device._data = { hc3DeviceId };
  device._name = 'Office Light';

  const app = createApp();
  app.getDeviceInfo = async () => deviceInfo;
  app.sendDeviceAction = async () => ({});
  device.homey = { app };
  return device;
}

describe('power metering (plan v1.3)', () => {
  it('adds measure_power dynamically on first power sighting', async () => {
    const device = createSwitchDevice();
    assert.strictEqual(device.hasCapability('measure_power'), false);

    await device.handleStateUpdate({ id: '32', power: 0.36 });
    assert.strictEqual(device.hasCapability('measure_power'), true);
    assert.strictEqual(device.getCapabilityValue('measure_power'), 0.36);
  });

  it('adds meter_power dynamically on first energy sighting', async () => {
    const device = createSwitchDevice();
    assert.strictEqual(device.hasCapability('meter_power'), false);

    await device.handleStateUpdate({ id: '32', energy: 1908.26 });
    assert.strictEqual(device.hasCapability('meter_power'), true);
    assert.strictEqual(device.getCapabilityValue('meter_power'), 1908.26);
  });

  it('rounds to 2 decimals and clamps negatives to 0', async () => {
    const device = createSwitchDevice();
    await device.handleStateUpdate({ id: '32', power: 0.3567, energy: 1908.2678 });
    assert.strictEqual(device.getCapabilityValue('measure_power'), 0.36);
    assert.strictEqual(device.getCapabilityValue('meter_power'), 1908.27);

    await device.handleStateUpdate({ id: '32', power: -2 });
    assert.strictEqual(device.getCapabilityValue('measure_power'), 0);
  });

  it('ignores null and non-numeric values without adding capabilities', async () => {
    const device = createSwitchDevice();
    await device.handleStateUpdate({ id: '32', power: null });
    await device.handleStateUpdate({ id: '32', energy: 'lots' });
    assert.strictEqual(device.hasCapability('measure_power'), false);
    assert.strictEqual(device.hasCapability('meter_power'), false);
  });

  it('devices without metering never gain the capabilities', async () => {
    const device = new ContactSensorDevice();
    device._data = { hc3DeviceId: '368' };
    device._name = 'Patio door';
    const app = createApp();
    app.getDeviceInfo = async () => ({ id: 368, properties: { value: true } });
    device.homey = { app };

    await device.handleStateUpdate({ id: '368', value: true, batteryLevel: 100 });
    assert.strictEqual(device.hasCapability('measure_power'), false);
    assert.strictEqual(device.hasCapability('meter_power'), false);
  });

  it('does not rewrite capabilities for unchanged values', async () => {
    const device = createSwitchDevice();
    let writes = 0;
    const originalSet = device.setCapabilityValue.bind(device);
    device.setCapabilityValue = async (id, value) => {
      writes += 1;
      return originalSet(id, value);
    };

    await device.handleStateUpdate({ id: '32', power: 5 });
    await device.handleStateUpdate({ id: '32', power: 5 });
    assert.strictEqual(writes, 1);
  });

  it('updateState applies initial power/energy from the HC3', async () => {
    const device = createSwitchDevice({
      deviceInfo: { id: 32, properties: { value: true, power: 120.5, energy: 2.9 } },
    });
    await device.updateState();
    assert.strictEqual(device.getCapabilityValue('measure_power'), 120.5);
    assert.strictEqual(device.getCapabilityValue('meter_power'), 2.9);
  });

  it('end-to-end: refreshStates power change routes to the paired device', async () => {
    const device = createSwitchDevice();
    const app = createApp({
      drivers: { switch: { getDevices: () => [device] } },
    });

    await app.handleRefreshStates({ last: 1, changes: [{ id: 32, power: 12.34 }] });
    assert.strictEqual(device.getCapabilityValue('measure_power'), 12.34);
  });

  it('power updates flow during an active command cooldown', async () => {
    const device = createSwitchDevice({
      deviceInfo: { id: 32, properties: { value: false } },
    });
    await device.onInit();
    await device.onCapabilityOnoff(true); // starts the command cooldown

    await device.handleStateUpdate({ id: '32', value: false, power: 87.65 });
    assert.strictEqual(device.getCapabilityValue('onoff'), false, 'onoff suppressed by cooldown');
    assert.strictEqual(device.getCapabilityValue('measure_power'), 87.65, 'power flows anyway');
  });
});
