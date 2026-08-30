'use strict';

const Hc3Device = require('../../lib/hc3-device');

class WindowCoveringDevice extends Hc3Device {

  async onInit() {
    this.registerCapabilityListener('windowcoverings_state', this.onCapabilityState.bind(this));
    this.registerCapabilityListener('windowcoverings_set', this.onCapabilitySet.bind(this));
    await super.onInit();
  }

  /**
   * Open/close/stop via the HC3. Homey windowcoverings_state enum:
   * up → open, down → close, idle → stop.
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilityState(value) {
    const action = { up: 'open', down: 'close', idle: 'stop' }[value];
    if (!action) {
      throw new Error(`Unsupported windowcoverings_state value: ${value}`);
    }

    const { hc3DeviceId } = this.getData();
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, action);
    } catch (error) {
      throw new Error(`Failed to control the window covering: ${error.message}`);
    }
  }

  /**
   * Set the position. Homey windowcoverings_set is 0-1 (0 = closed, 1 = open),
   * HC3 setValue expects 0-99/100.
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilitySet(value) {
    const { hc3DeviceId } = this.getData();
    const level = Math.round(value * 100);
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, 'setValue', [level]);
    } catch (error) {
      throw new Error(`Failed to set the position: ${error.message}`);
    }
  }

  /**
   * Map HC3 properties to the windowcoverings_set capability.
   * HC3 value is 0-99/100 (0 = closed, 100 = open); Homey expects 0-1.
   * Skipped during the command cooldown so a stale refreshStates response
   * cannot move the slider back right after a command.
   */
  async applyStateUpdate(properties) {
    if (!this.isInCommandCooldown()) {
      const level = parseFloat(properties.value);
      if (properties.value !== undefined && properties.value !== null && !Number.isNaN(level)) {
        const clamped = Math.min(Math.max(level, 0), 100);
        await this.setCapabilityIfChanged('windowcoverings_set', clamped / 100);
      }
    }

    await this.updateBatteryCapability(properties);
  }

}

module.exports = WindowCoveringDevice;
