'use strict';

const Hc3Device = require('../../lib/hc3-device');

class ContactSensorDevice extends Hc3Device {

  /**
   * Map HC3 properties to capabilities:
   * - value (boolean) → alarm_contact. HC3 door/window sensors report
   *   value=true when the contact is OPEN (breached) and false when closed
   *   (polarity per homebridge-fibaro: value=false → CONTACT_DETECTED).
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
        const isOpen = change.value === true || change.value === 'true';
        await this.setCapabilityIfChanged('alarm_contact', isOpen);
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

module.exports = ContactSensorDevice;
