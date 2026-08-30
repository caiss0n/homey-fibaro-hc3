'use strict';

const Hc3Device = require('../../lib/hc3-device');

// Homey device classes that make sense for an on/off-only HC3 binary switch.
// Subset of the official class list (homey-lib/assets/device/classes).
const SWITCH_DEVICE_CLASSES = [
  'socket', 'light', 'relay', 'fan', 'heater', 'kettle', 'coffeemachine',
  'airpurifier', 'humidifier', 'pump', 'sprinkler', 'watervalve',
  'tv', 'amplifier', 'speaker', 'mediaplayer', 'vacuumcleaner', 'lawnmower',
  'siren', 'other',
];

class SwitchDevice extends Hc3Device {

  async onInit() {
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    await super.onInit();
    await this.applyConfiguredDeviceClass();
  }

  /**
   * Apply the device class configured in the device settings ("Device type").
   * HC3 binary switches are generic — this lets each device appear as a light,
   * fan, heater, pump, etc. in Homey.
   */
  async applyConfiguredDeviceClass() {
    const configured = this.getSettings().deviceClass;
    if (configured && SWITCH_DEVICE_CLASSES.includes(configured) && this.getClass() !== configured) {
      this.log(`Applying configured device class: ${configured}`);
      await this.setClass(configured);
    }
  }

  /**
   * Called when the user changes the device settings.
   */
  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.includes('deviceClass')) return;

    const newClass = newSettings.deviceClass;
    if (!SWITCH_DEVICE_CLASSES.includes(newClass)) {
      throw new Error(`Unsupported device class: ${newClass}`);
    }

    this.log(`Device class changed to: ${newClass}`);
    await this.setClass(newClass);
  }

  /**
   * Turn the switch on/off via the HC3.
   * Throws on failure so Homey shows an error to the user and reverts the UI.
   */
  async onCapabilityOnoff(value) {
    const { hc3DeviceId } = this.getData();
    this.startCommandCooldown();

    try {
      await this.homey.app.sendDeviceAction(hc3DeviceId, value ? 'turnOn' : 'turnOff');
    } catch (error) {
      throw new Error(`Failed to control the switch: ${error.message}`);
    }
    // Homey applies the new capability value automatically when the listener resolves
  }

  /**
   * Map HC3 properties to the onoff capability.
   * Skipped during the command cooldown so a stale refreshStates response
   * cannot flip the UI back right after a command.
   */
  async applyStateUpdate(change) {
    // Route by HC3 device id (plan v1.2). Changes without an id are treated as
    // primary (v1.1 contract; refreshStates/updateState always carry an id).
    const isPrimary = change.id === undefined || change.id === null
      || String(change.id) === String(this.getData().hc3DeviceId);

    if (isPrimary) {
      // The cooldown suppresses only the controlled capability (onoff)
      if (!this.isInCommandCooldown()) {
        if (change.value !== undefined && change.value !== null) {
          const on = change.value === true || change.value === 'true';
          await this.setCapabilityIfChanged('onoff', on);
        }
      }
    } else {
      // Merged sibling measures keep flowing during command cooldowns
      const siblingCapability = this.resolveSiblingCapability(change.id);
      if (siblingCapability) {
        await this.applySiblingValue(siblingCapability, change);
      }
    }

    await this.updateBatteryCapability(change);
  }

}

module.exports = SwitchDevice;
