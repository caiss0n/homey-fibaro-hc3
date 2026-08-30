'use strict';

const Hc3Device = require('../../lib/hc3-device');

class MotionSensorDevice extends Hc3Device {

  /**
   * Map HC3 properties to capabilities:
   * - value (boolean) → alarm_motion (Homey flow triggers come free with this capability)
   * - batteryLevel (0-100) → measure_battery (added dynamically when present)
   * @param {object} properties - HC3 properties (or refreshStates change object)
   */
  async applyStateUpdate(change) {
    // Route by HC3 device id (plan v1.2). Changes without an id are treated as
    // primary (v1.1 contract; refreshStates/updateState always carry an id).
    const isPrimary = change.id === undefined || change.id === null
      || String(change.id) === String(this.getData().hc3DeviceId);

    if (isPrimary) {
      if (change.value !== undefined && change.value !== null) {
        const motion = change.value === true || change.value === 'true';
        await this.setCapabilityIfChanged('alarm_motion', motion);
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

module.exports = MotionSensorDevice;
