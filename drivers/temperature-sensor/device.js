'use strict';

const Hc3Device = require('../../lib/hc3-device');

class TemperatureSensorDevice extends Hc3Device {

  async onInit() {
    // HC3 temperature unit; learned from properties.unit when reported (default Celsius)
    this.temperatureUnit = 'C';
    await super.onInit();
  }

  /**
   * Map HC3 properties to the measure_temperature capability.
   * Routes by HC3 device id (plan v1.2): primary id → temperature; merged
   * sibling ids → their derived capability (e.g. humidity for all-sensor groups).
   * @param {object} change - HC3 properties (or refreshStates change) containing value/unit
   */
  async applyStateUpdate(change) {
    // Changes without an id are treated as primary (v1.1 contract)
    const isPrimary = change.id === undefined || change.id === null
      || String(change.id) === String(this.getData().hc3DeviceId);

    if (isPrimary) {
      if (typeof change.unit === 'string' && change.unit) {
        this.temperatureUnit = change.unit;
      }

      const rawValue = parseFloat(change.value);
      if (change.value !== undefined && change.value !== null && !Number.isNaN(rawValue)) {
        await this.setCapabilityIfChanged('measure_temperature', this.toCelsius(rawValue));
      }
    } else {
      const siblingCapability = this.resolveSiblingCapability(change.id);
      if (siblingCapability) {
        await this.applySiblingValue(siblingCapability, change);
      }
    }

    await this.updateBatteryCapability(change);
  }

  // toCelsius() is inherited from Hc3Device

}

module.exports = TemperatureSensorDevice;
