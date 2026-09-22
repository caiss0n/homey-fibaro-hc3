'use strict';

const Hc3Device = require('../../lib/hc3-device');

class BinarySensorDevice extends Hc3Device {

  /**
   * Map HC3 properties to capabilities:
   * - value (boolean) → alarm_generic. HC3 binary sensors report value=true
   *   when the sensor is ACTIVE (triggered) and false when inactive — same
   *   polarity convention as the motion and contact sensors.
   * - batteryLevel (0-100) → measure_battery (added dynamically when present)
   * @param {object} change - HC3 properties (or refreshStates change object)
   */
  async applyStateUpdate(change) {
    // Route by HC3 device id (plan v1.2). Changes without an id are treated as
    // primary (v1.1 contract; refreshStates/updateState always carry an id).
    const isPrimary = change.id === undefined || change.id === null
      || String(change.id) === String(this.getData().hc3DeviceId);

    if (isPrimary) {
      if (change.value !== undefined && change.value !== null) {
        const isActive = change.value === true || change.value === 'true';
        await this.setCapabilityIfChanged('alarm_generic', isActive);
      }
    } else {
      const siblingCapability = this.resolveSiblingCapability(change.id);
      if (siblingCapability) {
        await this.applySiblingValue(siblingCapability, change);
      }
    }

    await this.updateBatteryCapability(change);
  }

}

module.exports = BinarySensorDevice;
