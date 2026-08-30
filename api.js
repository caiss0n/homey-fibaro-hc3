'use strict';

module.exports = {

  /**
   * GET /test-connection — used by the settings page "Test Connection" button.
   * Validates the HC3 credentials against /api/settings/info.
   */
  async getTestConnection({ homey }) {
    return homey.app.testConnection();
  },

};
