'use strict';

const Hc3Device = require('../../lib/hc3-device');

class LockDevice extends Hc3Device {

  async onInit() {
    this.registerCapabilityListener('locked', this.onCapabilityLocked.bind(this));
    await super.onInit();
  }

  /**
   * Lock/unlock via the HC3 (actions secure/unsecure, per homebridge + Home
   * Assistant). Throws on failure so Homey shows an error and reverts the UI.
   */
  async onCapabilityLocked(value) {
    const { hc3DeviceId } = this.getData();
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, value ? 'secure' : 'unsecure', [0]);
    } catch (error) {
      throw new Error(`Failed to ${value ? 'lock' : 'unlock'} the device: ${error.message}`);
    }
  }

  /**
   * Map HC3 properties to the locked capability.
   * HC3 lock value: true = secured (locked), false = unsecured.
   */
  async applyStateUpdate(properties) {
    if (!this.isInCommandCooldown()) {
      if (properties.value !== undefined && properties.value !== null) {
        const locked = properties.value === true || properties.value === 'true';
        await this.setCapabilityIfChanged('locked', locked);
      }
    }

    await this.updateBatteryCapability(properties);
  }

}

module.exports = LockDevice;
