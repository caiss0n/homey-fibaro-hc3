'use strict';

/**
 * Test stub for the 'homey' module, which is only available inside the Homey
 * runtime. Installs a Module._load hook so that `require('homey')` in app.js
 * returns this stub. Must be required BEFORE app.js.
 */

const Module = require('module');

class HomeyAppStub {
  log(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.log(...args);
  }

  error(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.error(...args);
  }
}

class HomeyDriverStub {
  log(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.log(...args);
  }

  error(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.error(...args);
  }
}

class HomeyDeviceStub {
  constructor() {
    this._data = {};
    this._name = 'Test Device';
    this._capabilities = {};
    this._capabilityListeners = {};
    this._available = true;
    this._unavailableReason = null;
    this._class = 'socket';
    this._settings = {};
  }

  log(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.log(...args);
  }

  error(...args) {
    // eslint-disable-next-line no-console
    if (process.env.TEST_VERBOSE) console.error(...args);
  }

  getData() {
    return this._data;
  }

  getName() {
    return this._name;
  }

  getAvailable() {
    return this._available;
  }

  async setAvailable() {
    this._available = true;
    this._unavailableReason = null;
  }

  async setUnavailable(reason) {
    this._available = false;
    this._unavailableReason = reason || null;
  }

  getCapabilityValue(capabilityId) {
    return this._capabilities[capabilityId] !== undefined ? this._capabilities[capabilityId] : null;
  }

  async setCapabilityValue(capabilityId, value) {
    this._capabilities[capabilityId] = value;
  }

  hasCapability(capabilityId) {
    return capabilityId in this._capabilities;
  }

  async addCapability(capabilityId) {
    this._capabilities[capabilityId] = null;
  }

  async removeCapability(capabilityId) {
    delete this._capabilities[capabilityId];
  }

  registerCapabilityListener(capabilityId, callback) {
    this._capabilityListeners[capabilityId] = callback;
  }

  getClass() {
    return this._class;
  }

  async setClass(deviceClass) {
    this._class = deviceClass;
  }

  getSettings() {
    return this._settings;
  }
}

const homeyStub = {
  App: HomeyAppStub,
  Driver: HomeyDriverStub,
  Device: HomeyDeviceStub,
};

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
  if (request === 'homey') {
    return homeyStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

/**
 * In-memory mock of Homey's settings store (this.homey.settings).
 */
function createMockSettings(initial = {}) {
  const store = { ...initial };
  const listeners = [];
  return {
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value;
      listeners.forEach((callback) => callback(key));
    },
    unset: (key) => {
      delete store[key];
    },
    on: (event, callback) => {
      if (event === 'set') listeners.push(callback);
    },
    _store: store,
  };
}

/**
 * Create an app instance with a mocked `this.homey` context.
 * Does not call onInit(); call app.loadSettings() when settings are provided.
 */
function createApp({ settings = {}, drivers = {} } = {}) {
  // eslint-disable-next-line global-require
  const FibaroHc3App = require('../../app');
  const app = new FibaroHc3App();
  app.homey = {
    manifest: { version: '1.0.0-test' },
    settings: createMockSettings(settings),
    drivers: { getDrivers: () => drivers },
    // eslint-disable-next-line homey-app/global-timers
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    // eslint-disable-next-line homey-app/global-timers
    clearTimeout: (timeout) => clearTimeout(timeout),
  };
  return app;
}

module.exports = { createApp, createMockSettings };
