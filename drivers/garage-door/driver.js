'use strict';

const Homey = require('homey');

class GarageDoorDriver extends Homey.Driver {

  async onInit() {
    this.log('GarageDoorDriver has been initialized');
  }

  async onPair(session) {
    session.setHandler('list_devices', async () => {
      try {
        return await this.homey.app.getDevicesForDriver('garage-door');
      } catch (error) {
        this.error('Error listing devices:', error);
        throw new Error('Failed to load devices from HC3. Please check the app settings.');
      }
    });
  }

}

module.exports = GarageDoorDriver;
