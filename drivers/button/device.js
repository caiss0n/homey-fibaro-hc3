'use strict';

const Hc3Device = require('../../lib/hc3-device');

// HC3 CentralSceneEvent keyAttribute → Homey flow trigger card id
// (per homebridge pollerupdate.ts handleEvent and HC3 central scene docs)
const KEY_ATTRIBUTE_TRIGGERS = {
  Pressed: 'button_pressed',
  Pressed2: 'button_double_tapped',
  HeldDown: 'button_held',
  Released: 'button_released',
};

class ButtonDevice extends Hc3Device {

  async onInit() {
    // Get trigger cards once (Homey best practice)
    this.triggerCards = {};
    for (const triggerId of Object.values(KEY_ATTRIBUTE_TRIGGERS)) {
      this.triggerCards[triggerId] = this.homey.flow.getDeviceTriggerCard(triggerId);
    }
    await super.onInit();
  }

  /**
   * Buttons are event-driven — there is no state capability to sync.
   * CentralSceneEvents arrive via handleEvent() instead.
   */
  async applyStateUpdate() {
    // Nothing to map
  }

  /**
   * Called by the app's refreshStates handler when a CentralSceneEvent
   * arrives for this device.
   * @param {object} event - e.g. { type: 'CentralSceneEvent', data: { deviceId, keyId, keyAttribute } }
   */
  async handleEvent(event) {
    if (!event || event.type !== 'CentralSceneEvent') return;

    const data = event.data || {};
    const keyId = parseInt(data.keyId, 10);
    const { keyAttribute } = data;
    if (Number.isNaN(keyId) || !keyAttribute) return;

    const triggerId = KEY_ATTRIBUTE_TRIGGERS[keyAttribute];
    if (!triggerId) {
      this.log(`Unsupported keyAttribute '${keyAttribute}' on button ${keyId} — no flow triggered`);
      return;
    }

    this.log(`Button ${keyId} ${keyAttribute} → trigger ${triggerId}`);
    try {
      await this.triggerCards[triggerId].trigger(this, { button: keyId }, { button: keyId });
    } catch (error) {
      this.error(`Error triggering ${triggerId}: ${error.message}`);
    }
  }

}

module.exports = ButtonDevice;
