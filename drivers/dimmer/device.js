'use strict';

const Hc3Device = require('../../lib/hc3-device');

class DimmerDevice extends Hc3Device {

  async onInit() {
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
    await super.onInit();
  }

  /**
   * Turn the dimmer on/off via the HC3 (turnOn restores the last dim level).
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilityOnoff(value) {
    const { hc3DeviceId } = this.getData();
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, value ? 'turnOn' : 'turnOff');
    } catch (error) {
      throw new Error(`Failed to control the dimmer: ${error.message}`);
    }
  }

  /**
   * Set the dim level. Homey dim is 0-1, HC3 setValue expects 0-100.
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilityDim(value) {
    const { hc3DeviceId } = this.getData();
    const level = Math.round(value * 100);
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, 'setValue', [level]);
    } catch (error) {
      throw new Error(`Failed to set the dim level: ${error.message}`);
    }

    // Reflect on/off immediately; Homey applies the dim value itself on success
    await this.setCapabilityIfChanged('onoff', level > 0);
  }

  /**
   * Map HC3 properties to the dim (0-1) and onoff capabilities.
   * Skipped during the command cooldown to prevent slider flicker while the
   * user is dragging or the HC3 is still transitioning to the commanded level.
   */
  async applyStateUpdate(properties) {
    if (!this.isInCommandCooldown()) {
      const level = parseFloat(properties.value);
      if (properties.value !== undefined && properties.value !== null && !Number.isNaN(level)) {
        const clamped = Math.min(Math.max(level, 0), 100);
        await this.setCapabilityIfChanged('dim', clamped / 100);
        await this.setCapabilityIfChanged('onoff', clamped > 0);
      }
    }

    await this.updateBatteryCapability(properties);
  }

}

module.exports = DimmerDevice;
