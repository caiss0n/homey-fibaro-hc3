'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./helpers/homey-stub');

const ButtonDriver = require('../drivers/button/driver');
const ButtonDevice = require('../drivers/button/device');

function createDevice({ hc3DeviceId = '500' } = {}) {
  const device = new ButtonDevice();
  device._data = { hc3DeviceId };
  device._name = 'Keyfob';

  const triggers = [];
  const app = createApp();
  app.getDeviceInfo = async () => ({ id: 500, properties: {} });

  const flow = {
    getDeviceTriggerCard: (cardId) => ({
      trigger: async (deviceInstance, tokens, state) => {
        triggers.push({ cardId, tokens, state });
      },
    }),
  };

  device.homey = { app, flow };
  return { device, triggers };
}

describe('button device', () => {
  it('caches the four trigger cards on init', async () => {
    const { device } = createDevice();
    await device.onInit();
    assert.deepStrictEqual(Object.keys(device.triggerCards).sort(), [
      'button_double_tapped', 'button_held', 'button_pressed', 'button_released',
    ]);
  });

  it('maps Pressed → button_pressed with the button number as token and state', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    await device.handleEvent({
      type: 'CentralSceneEvent',
      data: { deviceId: 500, keyId: 2, keyAttribute: 'Pressed' },
    });

    assert.deepStrictEqual(triggers, [
      { cardId: 'button_pressed', tokens: { button: 2 }, state: { button: 2 } },
    ]);
  });

  it('maps Pressed2/HeldDown/Released to the right cards', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    await device.handleEvent({ type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 1, keyAttribute: 'Pressed2' } });
    await device.handleEvent({ type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 1, keyAttribute: 'HeldDown' } });
    await device.handleEvent({ type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 1, keyAttribute: 'Released' } });

    assert.deepStrictEqual(triggers.map((t) => t.cardId), [
      'button_double_tapped', 'button_held', 'button_released',
    ]);
  });

  it('reports the correct button number for multi-button devices', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    await device.handleEvent({ type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 5, keyAttribute: 'Pressed' } });
    assert.strictEqual(triggers[0].tokens.button, 5);
  });

  it('ignores unsupported keyAttributes without throwing', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    await device.handleEvent({ type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 1, keyAttribute: 'Pressed3' } });
    assert.strictEqual(triggers.length, 0);
  });

  it('ignores malformed events without throwing', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    await device.handleEvent(null);
    await device.handleEvent({});
    await device.handleEvent({ type: 'CentralSceneEvent' });
    await device.handleEvent({ type: 'CentralSceneEvent', data: { keyAttribute: 'Pressed' } });
    await device.handleEvent({ type: 'SceneActivationEvent', data: { deviceId: 500, sceneId: 7 } });

    assert.strictEqual(triggers.length, 0);
  });

  it('end-to-end: refreshStates CentralSceneEvent routes to the paired device and triggers the flow', async () => {
    const { device, triggers } = createDevice();
    await device.onInit();

    const app = createApp({
      drivers: { button: { getDevices: () => [device] } },
    });

    await app.handleRefreshStates({
      last: 999,
      events: [
        { type: 'CentralSceneEvent', data: { deviceId: 500, keyId: 3, keyAttribute: 'HeldDown' } },
      ],
    });

    assert.deepStrictEqual(triggers, [
      { cardId: 'button_held', tokens: { button: 3 }, state: { button: 3 } },
    ]);
  });
});

describe('button driver pairing', () => {
  it('list_devices returns remotes with central scene support only', async () => {
    const driver = new ButtonDriver();
    const app = createApp();
    app.getDevices = async () => [
      {
        id: 500,
        name: 'Keyfob',
        type: 'com.fibaro.remoteController',
        properties: { centralSceneSupport: [{ keyId: 1 }, { keyId: 2 }] },
      },
      {
        id: 501,
        name: 'Plain Remote',
        type: 'com.fibaro.remoteController',
        properties: { centralSceneSupport: [] },
      },
      {
        id: 502,
        name: 'Scene Controller',
        type: 'com.fibaro.remoteSceneController',
        properties: {},
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
      { name: 'Keyfob', data: { hc3DeviceId: '500' } },
      { name: 'Scene Controller', data: { hc3DeviceId: '502' } },
    ]);
  });
});
