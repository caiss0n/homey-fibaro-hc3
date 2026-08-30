'use strict';

const Hc3Device = require('../../lib/hc3-device');

class HumiditySensorDevice extends Hc3Device {

  /**
   * Map HC3 properties to capabilities:
   * - value (number, %) → measure_humidity (clamped 0-100)
   * - batteryLevel (0-100) → measure_battery (added dynamically when present)
   * @param {object} properties - HC3 properties (or refreshStates change object)
   */
  async applyStateUpdate(change) {
    // Route by HC3 device id (plan v1.2). Changes without an id are treated as
    // primary (v1.1 contract; refreshStates/updateState always carry an id).
    const isPrimary = change.id === undefined || change.id === null
      || String(change.id) === String(this.getData().hc3DeviceId);

    if (isPrimary) {
      const value = parseFloat(change.value);
      if (change.value !== undefined && change.value !== null && !Number.isNaN(value)) {
        await this.setCapabilityIfChanged('measure_humidity', Math.min(Math.max(value, 0), 100));
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

module.exports = HumiditySensorDevice;
