'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./helpers/homey-stub');

const FibaroHc3App = require('../app');
const ContactSensorDevice = require('../drivers/contact-sensor/device');
const SwitchDevice = require('../drivers/switch/device');

/**
 * Fixture mirroring the real HC3 group structures (see docs/plan1.2.md §3).
 */
function hc3Fixture() {
  return [
    { id: 1, name: 'zwave', type: 'com.fibaro.zwavePrimaryController' },
    { id: 8, name: 'zigbee', type: 'com.fibaro.zigbeePrimaryController' },
    // Group 366: contact + temperature (Patio door)
    {
      id: 366, name: '366', type: 'com.fibaro.zigbeeDevice', parentId: 8,
    },
    {
      id: 367, name: 'Device temperature', type: 'com.fibaro.temperatureSensor', parentId: 366, properties: {},
    },
    {
      id: 368, name: 'Patio door', type: 'com.fibaro.doorWindowSensor', parentId: 366, properties: {},
    },
    // Group 349: motion + temperature + light (multisensor)
    {
      id: 349, name: 'Node 55', type: 'com.fibaro.zwaveDevice', parentId: 1,
    },
    {
      id: 350, name: '55.0 Motion Sensor', type: 'com.fibaro.motionSensor', parentId: 349, properties: {},
    },
    {
      id: 351, name: 'Office', type: 'com.fibaro.temperatureSensor', parentId: 349, properties: {},
    },
    {
      id: 352, name: '55.0 Light Sensor', type: 'com.fibaro.lightSensor', parentId: 349, properties: {},
    },
    // Group 299: all-sensor group (temperature + humidity)
    {
      id: 299, name: '299', type: 'com.fibaro.zigbeeDevice', parentId: 8,
    },
    {
      id: 300, name: 'Master Bath Temperature', type: 'com.fibaro.temperatureSensor', parentId: 299, properties: {},
    },
    {
      id: 301, name: 'Master Bath Humidity', type: 'com.fibaro.humiditySensor', parentId: 299, properties: {},
    },
    // Group 224: ambiguous (2 switches + 2 temperatures)
    {
      id: 224, name: 'Garage Laser', type: 'com.fibaro.zigbeeDevice', parentId: 8,
    },
    {
      id: 234, name: 'Garage Door Switch', type: 'com.fibaro.binarySwitch', parentId: 224, properties: {},
    },
    {
      id: 235, name: 'Laser Switch', type: 'com.fibaro.binarySwitch', parentId: 224, properties: {},
    },
    {
      id: 236, name: 'Implant Temp', type: 'com.fibaro.temperatureSensor', parentId: 224, properties: {},
    },
    {
      id: 237, name: 'Garage Temperature', type: 'com.fibaro.temperatureSensor', parentId: 224, properties: {},
    },
    {
      id: 238, name: 'Garage Laser Beam', type: 'com.fibaro.binarySensor', parentId: 224, properties: {},
    },
    // Group with two temperature-only children (primary already has the capability)
    {
      id: 400, name: '400', type: 'com.fibaro.zigbeeDevice', parentId: 8,
    },
    {
      id: 401, name: 'Temp A', type: 'com.fibaro.temperatureSensor', parentId: 400, properties: {},
    },
    {
      id: 402, name: 'Temp B', type: 'com.fibaro.temperatureSensor', parentId: 400, properties: {},
    },
    // Ungrouped + dangling parent reference
    {
      id: 42, name: 'Standalone Temp', type: 'com.fibaro.temperatureSensor', properties: {},
    },
    {
      id: 43, name: 'Dangling Parent', type: 'com.fibaro.temperatureSensor', parentId: 9999, properties: {},
    },
  ];
}

function createAppWithFixture() {
  const app = createApp();
  app.getDevices = async () => hc3Fixture();
  return app;
}

describe('sibling merging — grouping & merge rules', () => {
  it('merges measure_* siblings into the primary of a group', () => {
    const app = createAppWithFixture();
    const { merged, absorbedIds } = app.buildMergedDevices(hc3Fixture());

    const patio = merged.get('368');
    assert.ok(patio, 'device 368 is a merged primary');
    assert.deepStrictEqual(patio.siblings, [{ capability: 'measure_temperature', hc3DeviceId: '367' }]);
    assert.ok(absorbedIds.has('367'));

    const motion = merged.get('350');
    assert.ok(motion, 'device 350 is a merged primary');
    assert.deepStrictEqual(motion.siblings, [
      { capability: 'measure_temperature', hc3DeviceId: '351' },
      { capability: 'measure_luminance', hc3DeviceId: '352' },
    ]);
    assert.ok(absorbedIds.has('351'));
    assert.ok(absorbedIds.has('352'));
  });

  it('all-sensor groups pick the temperature child as primary', () => {
    const app = createAppWithFixture();
    const { merged, absorbedIds } = app.buildMergedDevices(hc3Fixture());

    const bath = merged.get('300');
    assert.ok(bath, 'temperature child 300 is the primary');
    assert.strictEqual(bath.driverId, 'temperature-sensor');
    assert.deepStrictEqual(bath.siblings, [{ capability: 'measure_humidity', hc3DeviceId: '301' }]);
    assert.ok(absorbedIds.has('301'));
  });

  it('does not merge ambiguous groups (multiple primary-capable children)', () => {
    const app = createAppWithFixture();
    const { merged, absorbedIds } = app.buildMergedDevices(hc3Fixture());

    assert.strictEqual(merged.has('234'), false);
    assert.strictEqual(merged.has('235'), false);
    assert.strictEqual(absorbedIds.has('236'), false, 'temps of ambiguous groups stay standalone');
    assert.strictEqual(absorbedIds.has('237'), false);
  });

  it('does not absorb a capability the primary already has natively', () => {
    const app = createAppWithFixture();
    const { merged, absorbedIds } = app.buildMergedDevices(hc3Fixture());

    const tempA = merged.get('401');
    assert.ok(!tempA || tempA.siblings.length === 0, 'no same-capability sibling absorbed');
    assert.strictEqual(absorbedIds.has('402'), false);
  });

  it('ignores controller-parented children and dangling parent references', () => {
    const app = createAppWithFixture();
    const { merged, absorbedIds } = app.buildMergedDevices(hc3Fixture());

    assert.strictEqual(absorbedIds.has('349'), false);
    assert.strictEqual(merged.has('349'), false);
    assert.strictEqual(merged.has('43'), false);
    assert.strictEqual(absorbedIds.has('43'), false);
  });

  it('siblingCapabilityFor derives capabilities from HC3 types', () => {
    const app = createApp();
    assert.strictEqual(app.siblingCapabilityFor({ type: 'com.fibaro.temperatureSensor' }), 'measure_temperature');
    assert.strictEqual(app.siblingCapabilityFor({ type: 'com.fibaro.humiditySensor' }), 'measure_humidity');
    assert.strictEqual(app.siblingCapabilityFor({ type: 'com.fibaro.lightSensor' }), 'measure_luminance');
    assert.strictEqual(
      app.siblingCapabilityFor({ type: 'com.fibaro.multilevelSensor', properties: { deviceRole: 'LightSensor' } }),
      'measure_luminance',
    );
    assert.strictEqual(app.siblingCapabilityFor({ type: 'com.fibaro.binarySwitch' }), null);
    assert.strictEqual(app.siblingCapabilityFor({ type: 'com.fibaro.motionSensor' }), null);
    assert.strictEqual(app.siblingCapabilityFor(null), null);
  });
});

describe('sibling merging — pairing lists', () => {
  it('adds overridden capabilities and hc3Siblings to merged primaries', async () => {
    const app = createAppWithFixture();

    const contactList = await app.getDevicesForDriver('contact-sensor');
    // Length 2: the merged Patio door + the group-224 binary sensor (238),
    // which contact-sensor also lists via DRIVER_TYPE_ALIASES
    assert.strictEqual(contactList.length, 2);
    assert.deepStrictEqual(contactList[0], {
      name: 'Patio door',
      data: {
        hc3DeviceId: '368',
        hc3Siblings: [{ capability: 'measure_temperature', hc3DeviceId: '367' }],
      },
      capabilities: ['alarm_contact', 'measure_temperature'],
    });

    const motionList = await app.getDevicesForDriver('motion-sensor');
    assert.strictEqual(motionList.length, 1);
    assert.deepStrictEqual(motionList[0].capabilities, ['alarm_motion', 'measure_temperature', 'measure_luminance']);
    assert.strictEqual(motionList[0].data.hc3Siblings.length, 2);
  });

  it('excludes absorbed siblings from their own drivers but keeps standalone ones', async () => {
    const app = createAppWithFixture();

    const tempList = await app.getDevicesForDriver('temperature-sensor');
    const tempIds = tempList.map((device) => device.data.hc3DeviceId);

    assert.ok(!tempIds.includes('367'), 'merged temp child excluded');
    assert.ok(!tempIds.includes('351'), 'multisensor temp child excluded');
    assert.ok(tempIds.includes('42'), 'ungrouped temp included');
    assert.ok(tempIds.includes('236'), 'ambiguous-group temp included');
    assert.ok(tempIds.includes('237'), 'ambiguous-group temp included');
    assert.ok(tempIds.includes('402'), 'same-capability sibling stays pairable');

    const bathPrimary = tempList.find((device) => device.data.hc3DeviceId === '300');
    assert.ok(bathPrimary, 'all-sensor primary is pairable under temperature-sensor');
    assert.deepStrictEqual(bathPrimary.capabilities, ['measure_temperature', 'measure_humidity']);

    const humidityList = await app.getDevicesForDriver('humidity-sensor');
    assert.strictEqual(humidityList.length, 0, 'absorbed humidity child excluded');
  });

  it('leaves ambiguous groups fully pairable without siblings', async () => {
    const app = createAppWithFixture();

    const switchList = await app.getDevicesForDriver('switch');
    const garageSwitch = switchList.find((device) => device.data.hc3DeviceId === '234');
    const laserSwitch = switchList.find((device) => device.data.hc3DeviceId === '235');
    assert.ok(garageSwitch && laserSwitch, 'both switches pairable');
    assert.strictEqual(garageSwitch.data.hc3Siblings, undefined);
    assert.strictEqual(laserSwitch.data.hc3Siblings, undefined);

    // Binary sensor children are never absorbed into the ambiguous group either
    const binaryList = await app.getDevicesForDriver('binary-sensor');
    const laserBeam = binaryList.find((device) => device.data.hc3DeviceId === '238');
    assert.ok(laserBeam, 'binary sensor pairable');
    assert.strictEqual(laserBeam.data.hc3Siblings, undefined);
  });
});

describe('sibling merging — state routing & device behavior', () => {
  function createMergedContactDevice({ siblingFails = false } = {}) {
    const device = new ContactSensorDevice();
    device._data = {
      hc3DeviceId: '368',
      hc3Siblings: [{ capability: 'measure_temperature', hc3DeviceId: '367' }],
    };
    device._name = 'Patio door';

    const fetchedIds = [];
    const app = createApp();
    app.getDeviceInfo = async (id) => {
      fetchedIds.push(String(id));
      if (String(id) === '367' && siblingFails) throw new Error('sibling gone');
      if (String(id) === '368') return { id: 368, properties: { value: true, batteryLevel: 100 } };
      if (String(id) === '367') return { id: 367, properties: { value: 18.5, unit: 'C' } };
      return null;
    };
    device.homey = { app };
    return { device, fetchedIds };
  }

  it('routes primary and sibling changes by change.id', async () => {
    const { device } = createMergedContactDevice();

    await device.handleStateUpdate({ id: 368, value: true });
    await device.handleStateUpdate({ id: 367, value: 21.5 });
    await device.handleStateUpdate({ id: 999, value: 1 }); // unknown id → ignored

    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 21.5);
  });

  it('learns the temperature unit from sibling changes (F→C)', async () => {
    const { device } = createMergedContactDevice();

    await device.handleStateUpdate({ id: 367, value: 68, unit: 'F' });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 20);
  });

  it('updateState fetches primary and siblings', async () => {
    const { device, fetchedIds } = createMergedContactDevice();
    await device.updateState();

    assert.deepStrictEqual(fetchedIds, ['368', '367']);
    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 18.5);
    assert.strictEqual(device.getAvailable(), true);
  });

  it('updateState keeps the primary healthy when a sibling fetch fails', async () => {
    const { device } = createMergedContactDevice({ siblingFails: true });
    await device.updateState();

    assert.strictEqual(device.getCapabilityValue('alarm_contact'), true);
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), null);
    assert.strictEqual(device.getAvailable(), true, 'sibling failure does not affect availability');
  });

  it('findPairedDevices matches merged sibling ids', async () => {
    const { device } = createMergedContactDevice();
    const app = createApp({
      drivers: { 'contact-sensor': { getDevices: () => [device] } },
    });

    assert.deepStrictEqual(app.findPairedDevices('368'), [device]);
    assert.deepStrictEqual(app.findPairedDevices('367'), [device]);
    assert.deepStrictEqual(app.findPairedDevices('999'), []);
  });

  it('end-to-end: refreshStates change for a sibling reaches the merged device', async () => {
    const { device } = createMergedContactDevice();
    const app = createApp({
      drivers: { 'contact-sensor': { getDevices: () => [device] } },
    });

    await app.handleRefreshStates({ last: 1, changes: [{ id: 367, value: 19 }] });
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 19);
  });
});

describe('sibling merging — cooldown & manifest consistency', () => {
  it('switch cooldown suppresses onoff but sibling measures keep flowing', async () => {
    const device = new SwitchDevice();
    device._data = {
      hc3DeviceId: '21',
      hc3Siblings: [{ capability: 'measure_temperature', hc3DeviceId: '22' }],
    };
    device._name = 'MasterBed Oil Heater';

    const app = createApp();
    app.getDeviceInfo = async () => ({ id: 21, properties: { value: false } });
    app.sendDeviceAction = async () => ({});
    device.homey = { app };

    await device.onInit();
    await device.onCapabilityOnoff(true); // starts the command cooldown

    await device.handleStateUpdate({ id: 21, value: false }); // suppressed by cooldown
    await device.handleStateUpdate({ id: 22, value: 17.5 }); // sibling flows anyway

    assert.strictEqual(device.getCapabilityValue('onoff'), false);
    assert.strictEqual(device.getCapabilityValue('measure_temperature'), 17.5);
  });

  it('DRIVER_BASE_CAPABILITIES matches every driver.compose.json', () => {
    const driversDir = path.join(__dirname, '..', 'drivers');
    const dirs = fs.readdirSync(driversDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const dir of dirs) {
      const composePath = path.join(driversDir, dir, 'driver.compose.json');
      if (!fs.existsSync(composePath)) continue;
      const compose = JSON.parse(fs.readFileSync(composePath, 'utf8'));
      assert.deepStrictEqual(
        FibaroHc3App.DRIVER_BASE_CAPABILITIES[compose.id],
        compose.capabilities,
        `DRIVER_BASE_CAPABILITIES['${compose.id}'] must match its driver.compose.json`,
      );
    }
  });
});
