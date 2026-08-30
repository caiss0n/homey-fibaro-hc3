'use strict';

/**
 * Live connection smoke test against a real HC3 on the local network.
 * Reads credentials from the gitignored .env file (hc3_ip, hc3_username, hc3_password).
 *
 * Usage: npm run test:live
 */

const fs = require('fs');
const path = require('path');
const { createApp } = require('../test/helpers/homey-stub');

function loadEnvFile(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

// eslint-disable-next-line homey-app/global-timers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeBool = (value) => value === true || value === 'true' || value === 1;

async function readDeviceValue(app, deviceId) {
  const info = await app.getDeviceInfo(deviceId);
  return info && info.properties ? info.properties.value : undefined;
}

function findCandidateByName(candidates, wantedName) {
  const needle = wantedName.trim().toLowerCase();
  return candidates.find((candidate) => (candidate.name || '').trim().toLowerCase() === needle);
}

/**
 * Command test for Phase 3. STRICTLY limited to the two user-approved devices:
 * 'office light' (switch) and 'Corridor Light' (dimmer). Every other device is
 * read-only. Both test devices are restored to their original state afterwards.
 */
async function runCommandTests(app) {
  let allOk = true;

  // --- Switch: 'office light' ---
  const switchTarget = findCandidateByName(await app.getDevicesForDriver('switch'), 'office light');
  if (!switchTarget) {
    console.log("  ⚠ 'office light' not found among switch candidates — switch command test skipped");
  } else {
    const id = switchTarget.data.hc3DeviceId;
    const original = normalizeBool(await readDeviceValue(app, id));
    console.log(`  switch '${switchTarget.name}' (HC3 id ${id}) — original state: ${original ? 'on' : 'off'}`);

    let afterOn = false;
    try {
      await app.sendDeviceAction(id, 'turnOn');
      await sleep(1500);
      afterOn = normalizeBool(await readDeviceValue(app, id));
      console.log(`    turnOn → ${afterOn ? 'on' : 'off'} ${afterOn ? '✓' : '✗ FAILED'}`);
    } finally {
      // Always restore the original state, even if a step above failed
      await app.sendDeviceAction(id, original ? 'turnOn' : 'turnOff');
      await sleep(1500);
    }
    const restored = normalizeBool(await readDeviceValue(app, id));
    console.log(`    restored → ${restored ? 'on' : 'off'} ${restored === original ? '✓' : '✗ FAILED'}`);

    if (!afterOn || restored !== original) allOk = false;
  }

  // --- Dimmer: 'Corridor Light' ---
  const dimmerTarget = findCandidateByName(await app.getDevicesForDriver('dimmer'), 'corridor light');
  if (!dimmerTarget) {
    console.log("  ⚠ 'Corridor Light' not found among dimmer candidates — dimmer command test skipped");
  } else {
    const id = dimmerTarget.data.hc3DeviceId;
    const originalLevel = parseFloat(await readDeviceValue(app, id));
    if (Number.isNaN(originalLevel)) {
      console.log(`  ⚠ '${dimmerTarget.name}' reports no numeric value — dimmer command test skipped`);
    } else {
      const testLevel = Math.round(originalLevel) === 40 ? 70 : 40;
      console.log(`  dimmer '${dimmerTarget.name}' (HC3 id ${id}) — original level: ${originalLevel}%`);

      let levelOk = false;
      try {
        await app.sendDeviceAction(id, 'setValue', [testLevel]);
        await sleep(1500);
        const afterSet = parseFloat(await readDeviceValue(app, id));
        levelOk = Math.abs(afterSet - testLevel) <= 2;
        console.log(`    setValue ${testLevel} → ${afterSet}% ${levelOk ? '✓' : '✗ FAILED'}`);
      } finally {
        // Always restore the original level, even if a step above failed
        await app.sendDeviceAction(id, 'setValue', [Math.round(originalLevel)]);
        await sleep(1500);
      }
      const restoredLevel = parseFloat(await readDeviceValue(app, id));
      const restoreOk = Math.abs(restoredLevel - originalLevel) <= 2;
      console.log(`    restored → ${restoredLevel}% ${restoreOk ? '✓' : '✗ FAILED'}`);

      if (!levelOk || !restoreOk) allOk = false;
    }
  }

  return allOk;
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`✗ .env file not found at ${envPath}`);
    console.error('  Create it with: hc3_ip=..., hc3_username=..., hc3_password=...');
    return false;
  }

  const env = loadEnvFile(envPath);
  const missing = ['hc3_ip', 'hc3_username', 'hc3_password'].filter((key) => !env[key]);
  if (missing.length > 0) {
    console.error(`✗ Missing keys in .env: ${missing.join(', ')}`);
    return false;
  }

  const app = createApp({
    settings: {
      hc3_ip: env.hc3_ip,
      hc3_username: env.hc3_username,
      hc3_password: env.hc3_password,
    },
  });
  app.version = 'live-test';
  app.loadSettings();

  // 1. Connection test
  console.log(`Testing connection to HC3 at ${env.hc3_ip}...`);
  const result = await app.testConnection();

  if (!result.success) {
    console.error(`✗ Connection failed: ${result.error}`);
    return false;
  }

  console.log('✓ Connection successful!');
  console.log(`  Name:        ${result.info.hcName || '-'}`);
  console.log(`  Platform:    ${result.info.platform || '-'}`);
  console.log(`  Serial:      ${result.info.serialNumber || '-'}`);
  console.log(`  Firmware:    ${result.info.firmwareVersion || '-'}`);
  console.log(`  Z-Wave:      ${result.info.zwaveVersion || '-'}`);
  console.log(`  MAC:         ${result.info.mac || '-'}`);
  console.log(`  Devices:     ${result.info.deviceCount !== undefined ? result.info.deviceCount : '-'}`);

  // 2. Device auto-detection summary
  const devices = await app.getDevices();
  const summary = {};
  const unmapped = [];
  for (const device of devices) {
    const driverId = app.mapDeviceToDriver(device);
    if (driverId) {
      summary[driverId] = (summary[driverId] || 0) + 1;
    } else {
      unmapped.push(`    - ${device.name || `ID ${device.id}`} (type: ${device.type || 'unknown'})`);
    }
  }

  console.log(`\n✓ Driver auto-detection over ${devices.length} HC3 devices:`);
  for (const [driverId, count] of Object.entries(summary).sort()) {
    console.log(`    ${driverId}: ${count}`);
  }
  if (unmapped.length > 0) {
    console.log(`  Unmapped (${unmapped.length}):`);
    for (const line of unmapped.slice(0, 20)) console.log(line);
    if (unmapped.length > 20) console.log(`    ... and ${unmapped.length - 20} more`);
  }

  // 3. Pairing flow proof: list candidates for each implemented driver
  const implementedDrivers = ['temperature-sensor', 'motion-sensor', 'switch', 'dimmer', 'contact-sensor', 'window-covering', 'garage-door', 'lock', 'button', 'light-sensor', 'humidity-sensor'];
  for (const driverId of implementedDrivers) {
    const candidates = await app.getDevicesForDriver(driverId);
    console.log(`\n✓ Pairing candidates for '${driverId}' (${candidates.length}):`);
    for (const candidate of candidates.slice(0, 25)) {
      const mergedNote = candidate.capabilities ? ` [merged: ${candidate.capabilities.join(', ')}]` : '';
      console.log(`    - ${candidate.name} (HC3 id: ${candidate.data.hc3DeviceId})${mergedNote}`);
    }
    if (candidates.length > 25) {
      console.log(`    ... and ${candidates.length - 25} more`);
    }
  }

  // 4. Command test (Phase 3) — READ-ONLY for all devices EXCEPT the two
  // user-approved test devices: 'office light' (switch) and 'Corridor Light'
  // (dimmer). Both are restored to their original state at the end.
  console.log('\nCommand test (approved devices only):');
  const commandsOk = await runCommandTests(app);

  // 5. Power/energy metering spot check (plan v1.3) — read-only
  console.log('\nPower/energy metering (read-only):');
  for (const id of [21, 25, 32, 100]) {
    try {
      const info = await app.getDeviceInfo(id);
      const props = (info && info.properties) || {};
      console.log(`  ${(info && info.name) || `id ${id}`} (id ${id}): power=${props.power} W, energy=${props.energy} kWh`);
    } catch (error) {
      console.log(`  id ${id}: read failed (${error.message})`);
    }
  }

  // 6. refreshStates smoke check
  app.lastPoll = 0;
  app.pollerActive = false;
  app.consecutivePollFailures = 0;
  app.pollingUpdateRunning = false;
  await app.pollRefreshStates();
  console.log(`\n✓ refreshStates poll succeeded (last=${app.lastPoll})`);

  if (!commandsOk) {
    console.log('\n✗ One or more command checks failed.');
    return false;
  }

  console.log('\nAll live checks passed.');
  return true;
}

main()
  .then((success) => {
    process.exitCode = success ? 0 : 1;
  })
  .catch((error) => {
    console.error(`✗ Unexpected error: ${error.message}`);
    process.exitCode = 1;
  });
