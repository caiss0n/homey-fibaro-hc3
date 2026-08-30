'use strict';

const Hc3Device = require('../../lib/hc3-device');

// Garage doors move slowly (~10-15s). Use a longer command cooldown than the
// default 2s so mid-transit positions reported by refreshStates don't flip
// the toggle back while the door is still moving.
const GARAGE_DOOR_COMMAND_COOLDOWN_MS = 20000;

class GarageDoorDevice extends Hc3Device {

  async onInit() {
    this.commandCooldownMs = GARAGE_DOOR_COMMAND_COOLDOWN_MS;
    this.registerCapabilityListener('garagedoor_closed', this.onCapabilityGarageDoorClosed.bind(this));
    await super.onInit();
  }

  /**
   * Open/close the garage door via the HC3.
   * garagedoor_closed=true → close, false → open.
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilityGarageDoorClosed(value) {
    const { hc3DeviceId } = this.getData();
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, value ? 'close' : 'open');
    } catch (error) {
      throw new Error(`Failed to control the garage door: ${error.message}`);
    }
  }

  /**
   * Map HC3 properties to the garagedoor_closed capability.
   * HC3 rollerShutter/barrier value: 0 = closed, 100 = open, anything between
   * = not closed. HC3 quirk (per homebridge): 1 = fully closed, 99 = fully open.
   */
  async applyStateUpdate(properties) {
    if (!this.isInCommandCooldown()) {
      const level = parseFloat(properties.value);
      if (properties.value !== undefined && properties.value !== null && !Number.isNaN(level)) {
        let normalized = level;
        if (level === 1) normalized = 0; // quirk: 1 = fully closed
        if (level === 99) normalized = 100; // quirk: 99 = fully open
        await this.setCapabilityIfChanged('garagedoor_closed', normalized === 0);
      }
    }

    await this.updateBatteryCapability(properties);
  }

}

module.exports = GarageDoorDevice;
