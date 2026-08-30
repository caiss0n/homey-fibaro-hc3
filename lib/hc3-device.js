'use strict';

const Homey = require('homey');

// After sending a command to the HC3, refreshStates updates for that device are
// ignored for this long. Prevents UI flicker (e.g. dimmer sliders) while the
// HC3 transitions to the new state.
const COMMAND_COOLDOWN_MS = 2000;

/**
 * Base class for all HC3-backed Homey devices.
 *
 * Subclasses implement applyStateUpdate(properties) to map HC3 device
 * properties to Homey capabilities. The base class handles:
 * - the initial state fetch from the HC3 (onInit → updateState)
 * - error handling around state updates (never crash the poller)
 * - availability tracking (device is marked unavailable when the HC3 is
 *   unreachable and available again when updates resume)
 */
class Hc3Device extends Homey.Device {

  async onInit() {
    this.log(`${this.constructor.name} initialized: ${this.getName()} (HC3 id: ${this.getData().hc3DeviceId})`);
    await this.updateState();
  }

  /**
   * Called by the app's refreshStates poller when this device's state changes.
   * Template method: wraps applyStateUpdate with error handling and
   * availability recovery. Do not override — override applyStateUpdate.
   * @param {object} properties - HC3 properties (or refreshStates change object)
   */
  async handleStateUpdate(properties) {
    try {
      await this.applyStateUpdate(properties);
      // Power/energy metering (plan v1.3) — measurements, not controlled state,
      // so they intentionally flow even during command cooldowns
      await this.updatePowerMetering(properties);
      // A successful update means the HC3 connection is alive again
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (error) {
      this.error(`Error handling state update: ${error.message}`);
    }
  }

  /**
   * Map a HC3 state update to Homey capabilities. Override in subclasses.
   * @param {object} properties - HC3 properties (or refreshStates change object)
   */
  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
  async applyStateUpdate(properties) {
    // Subclasses override
  }

  /**
   * Fetch the current state from the HC3 (called once on init). Fetches the
   * primary device AND every merged sibling (plan v1.2), dispatching each
   * result as handleStateUpdate({ id, ...properties }).
   */
  async updateState() {
    const data = this.getData();
    const { hc3DeviceId } = data;
    const siblings = Array.isArray(data.hc3Siblings) ? data.hc3Siblings : [];

    try {
      const deviceInfo = await this.homey.app.getDeviceInfo(hc3DeviceId);
      if (deviceInfo && deviceInfo.properties) {
        await this.handleStateUpdate({ id: hc3DeviceId, ...deviceInfo.properties });
      }
    } catch (error) {
      this.error(`Failed to fetch state from HC3: ${error.message}`);
      await this.setUnavailable(`Cannot reach HC3: ${error.message}`);
      return; // HC3 is unreachable — siblings would fail too
    }

    for (const sibling of siblings) {
      if (!sibling || !sibling.hc3DeviceId) continue;
      try {
        const siblingInfo = await this.homey.app.getDeviceInfo(sibling.hc3DeviceId);
        if (siblingInfo && siblingInfo.properties) {
          await this.handleStateUpdate({ id: sibling.hc3DeviceId, ...siblingInfo.properties });
        }
      } catch (error) {
        // A failing sibling never affects the primary device's availability
        this.error(`Failed to fetch sibling ${sibling.hc3DeviceId} state: ${error.message}`);
      }
    }
  }

  /**
   * Resolve which merged capability a sibling HC3 device id feeds (plan v1.2).
   */
  resolveSiblingCapability(changeId) {
    const data = this.getData() || {};
    const siblings = Array.isArray(data.hc3Siblings) ? data.hc3Siblings : [];
    const match = siblings.find((sibling) => String(sibling.hc3DeviceId) === String(changeId));
    return match ? match.capability : null;
  }

  /**
   * Apply a merged sibling's value to its capability (plan v1.2).
   * Learns the temperature unit from the change when present (default Celsius).
   */
  async applySiblingValue(capabilityId, change) {
    if (typeof change.unit === 'string' && change.unit) {
      this.temperatureUnit = change.unit;
    }

    const value = parseFloat(change.value);
    if (change.value === undefined || change.value === null || Number.isNaN(value)) return;

    switch (capabilityId) {
      case 'measure_temperature':
        await this.setCapabilityIfChanged('measure_temperature', this.toCelsius(value));
        break;
      case 'measure_humidity':
        await this.setCapabilityIfChanged('measure_humidity', Math.min(Math.max(value, 0), 100));
        break;
      case 'measure_luminance':
        await this.setCapabilityIfChanged('measure_luminance', Math.max(value, 0));
        break;
      default:
        break;
    }
  }

  /**
   * Convert a reported temperature to Celsius (Homey's measure_temperature unit).
   * this.temperatureUnit defaults to Celsius when never learned.
   */
  toCelsius(value) {
    if (this.temperatureUnit === 'F') {
      return Math.round((((value - 32) * 5) / 9) * 10) / 10;
    }
    return value;
  }

  /**
   * Map an HC3 batteryLevel (0-100) to the measure_battery capability.
   * The capability is added dynamically on first sight, so mains-powered
   * devices never show an empty battery tile.
   */
  async updateBatteryCapability(properties) {
    if (properties.batteryLevel === undefined || properties.batteryLevel === null) return;

    const level = parseFloat(properties.batteryLevel);
    if (Number.isNaN(level)) return;

    if (!this.hasCapability('measure_battery')) {
      await this.addCapability('measure_battery');
    }

    const clamped = Math.min(Math.max(level, 0), 100);
    if (this.getCapabilityValue('measure_battery') !== clamped) {
      await this.setCapabilityValue('measure_battery', clamped);
    }
  }

  /**
   * Set a capability only when the value actually changed.
   */
  async setCapabilityIfChanged(capabilityId, value) {
    if (this.getCapabilityValue(capabilityId) !== value) {
      await this.setCapabilityValue(capabilityId, value);
    }
  }

  /**
   * Map HC3 power/energy metering to Homey capabilities (plan v1.3):
   * - properties.power (W) → measure_power
   * - properties.energy (kWh) → meter_power
   * Capabilities are added dynamically on first sight, so devices without
   * metering never show an empty tile.
   */
  async updatePowerMetering(properties) {
    if (!properties || typeof properties !== 'object') return;

    if (properties.power !== undefined && properties.power !== null) {
      const power = parseFloat(properties.power);
      if (!Number.isNaN(power)) {
        if (!this.hasCapability('measure_power')) {
          await this.addCapability('measure_power');
        }
        const rounded = Math.round(Math.max(power, 0) * 100) / 100;
        await this.setCapabilityIfChanged('measure_power', rounded);
      }
    }

    if (properties.energy !== undefined && properties.energy !== null) {
      const energy = parseFloat(properties.energy);
      if (!Number.isNaN(energy)) {
        if (!this.hasCapability('meter_power')) {
          await this.addCapability('meter_power');
        }
        const rounded = Math.round(Math.max(energy, 0) * 100) / 100;
        await this.setCapabilityIfChanged('meter_power', rounded);
      }
    }
  }

  /**
   * Start the command cooldown (called right before sending a command to the HC3).
   * Duration can be overridden per instance via this.commandCooldownMs.
   */
  startCommandCooldown() {
    const duration = this.commandCooldownMs !== undefined ? this.commandCooldownMs : COMMAND_COOLDOWN_MS;
    this.commandCooldownUntil = Date.now() + duration;
  }

  /**
   * True while a command cooldown is active. Controllable devices should skip
   * refreshStates updates of their controlled capabilities during this window.
   */
  isInCommandCooldown() {
    return Date.now() < (this.commandCooldownUntil || 0);
  }

  async onDeleted() {
    this.log(`${this.constructor.name} deleted: ${this.getName()}`);
  }

}

module.exports = Hc3Device;
