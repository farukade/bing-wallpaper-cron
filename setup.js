#!/usr/bin/env node
// Cross-platform installer for bing-wallpaper-cron.
// Usage:
//   node setup.js              # install packages + register autostart
//   node setup.js --skip-install
//   node setup.js --uninstall
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const APP = path.join(ROOT, 'index.js');
const LOG_FILE = path.join(ROOT, 'autostart.log');
const PLATFORM = process.platform;
const USER = os.userInfo().username;
const UNINSTALL = process.argv.includes('--uninstall');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0 && !opts.tolerateFailure) {
    throw new Error(`Command failed (${res.status ?? res.error?.message}): ${cmd} ${args.join(' ')}`);
  }
  return res;
}

async function isInstalled(cmd) {
  const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return res.status === 0;
}

async function installPackages() {
  console.log('📦 Installing dependencies (npm install)...');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install']);
}

// ─── macOS: LaunchAgent ────────────────────────────────────────────────
async function macSetup() {
  const label = `com.${USER}.bing-wallpaper`;
  const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const dom = `gui/${process.getuid()}/${label}`;

  if (UNINSTALL) {
    run('launchctl', ['bootout', dom], { tolerateFailure: true });
    try { await fs.unlink(plist); } catch {}
    console.log('🗑️  Removed autostart:', label);
    return;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${APP}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
`;

  await fs.mkdir(path.dirname(plist), { recursive: true });
  await fs.writeFile(plist, xml);
  run('launchctl', ['bootout', dom], { tolerateFailure: true });
  run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  console.log('✅ Scheduled: LaunchAgent starts at login and restarts on crash.');
  console.log('   Verify: launchctl list | grep bing-wallpaper');
}

// ─── Linux: systemd user service (fallback: .desktop autostart) ────────
async function linuxSetup() {
  const serviceName = 'bing-wallpaper.service';
  const unitDir = path.join(os.homedir(), '.config/systemd/user');
  const unitFile = path.join(unitDir, serviceName);
  const desktopFile = path.join(os.homedir(), '.config/autostart', 'bing-wallpaper.desktop');

  if (UNINSTALL) {
    if (await isInstalled('systemctl')) {
      run('systemctl', ['--user', 'disable', '--now', serviceName], { tolerateFailure: true });
      await fs.rm(unitDir, { recursive: true, force: true }).catch(() => {});
    }
    try { await fs.unlink(desktopFile); } catch {}
    console.log('🗑️  Removed autostart configuration.');
    return;
  }

  if (await isInstalled('systemctl')) {
    const unit = `[Unit]
Description=Bing daily wallpaper
After=graphical-session.target

[Service]
ExecStart=${NODE} ${APP}
WorkingDirectory=${ROOT}
Restart=on-failure
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`;

    await fs.mkdir(unitDir, { recursive: true });
    await fs.writeFile(unitFile, unit);
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', serviceName]);
    console.log('✅ Scheduled: systemd user service starts at login and restarts on crash.');
    console.log('   Verify: systemctl --user status ' + serviceName);
    console.log('   Tip: `loginctl enable-linger ' + USER +
      '` starts it even when not logged in.');
  } else {
    // Non-systemd distro: plain autostart entry, no auto-restart
    const entry = `[Desktop Entry]
Type=Application
Name=Bing Wallpaper
Exec=${NODE} ${APP}
X-GNOME-Autostart-enabled=true
`;
    await fs.mkdir(path.dirname(desktopFile), { recursive: true });
    await fs.writeFile(desktopFile, entry);
    console.log('✅ Scheduled: autostart entry added (~/.config/autostart). No auto-restart on this system.');
  }
}

// ─── Windows: Scheduled Task at logon ──────────────────────────────────
async function winSetup() {
  const TASK = 'BingWallpaper';

  if (UNINSTALL) {
    run('schtasks', ['/Delete', '/TN', TASK, '/F'], { tolerateFailure: true });
    console.log('🗑️  Removed scheduled task:', TASK);
    return;
  }

  // schtasks needs inner quotes escaped with backslash inside the /TR value
  const command = `\\"${NODE}\\" \\"${APP}\\"`;
  run('schtasks', [
    '/Create', '/TN', TASK,
    '/TR', `"${command}"`,
    '/SC', 'ONLOGON',
    '/RL', 'LIMITED',
    '/F',
  ]);
  console.log('✅ Scheduled: task "' + TASK + '" runs at logon (hidden window).');
  console.log('   Verify: schtasks /Query /TN ' + TASK);
  console.log('   Amount logged on: ' + os.homedir());
}

async function main() {
  try {
    if (!UNINSTALL && !process.argv.includes('--skip-install')) {
      await installPackages();
    }
    if (PLATFORM === 'darwin') await macSetup();
    else if (PLATFORM === 'linux') await linuxSetup();
    else if (PLATFORM === 'win32') await winSetup();
    else throw new Error(`Unsupported platform: ${PLATFORM}`);

    if (!UNINSTALL) {
      console.log('\n🎉 Done. The service is registered and will start at your next logon.');
      console.log(`   Logs: ${LOG_FILE}`);
    }
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

await main();