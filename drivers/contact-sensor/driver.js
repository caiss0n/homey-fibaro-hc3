'use strict';

const Homey = require('homey');

class ContactSensorDriver extends Homey.Driver {

  async onInit() {
    this.log('ContactSensorDriver has been initialized');
  }

  async onPair(session) {
    session.setHandler('list_devices', async () => {
      try {
        return await this.homey.app.getDevicesForDriver('contact-sensor');
      } catch (error) {
        this.error('Error listing devices:', error);
        throw new Error('Failed to load devices from HC3. Please check the app settings.');
      }
    });
  }

}

module.exports = ContactSensorDriver;
