const { app, BrowserWindow, Menu, Tray, clipboard, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

const APP_NAME = 'Typerly';
const STARTUP_ARGUMENTS = ['--hidden'];
const DEFAULT_SETTINGS = {
  settingsSchemaVersion: 2,
  delayMs: 30,
  countdownSeconds: 3,
  shortcut: 'Control+Alt+T',
  theme: 'light',
  launchAtLogin: false
};

let mainWindow;
let countdownWindow;
let tray;
let worker;
let workerReady = false;
let registeredShortcut = null;
let updateReadyVersion = null;
let updateState = { state: 'idle', version: null };
let currentJob = null;
let countdownTimer;
let isQuitting = false;
let startingJob = false;
let settings = { ...DEFAULT_SETTINGS };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function resourceFile(filename, developmentPath) {
  return app.isPackaged ? path.join(process.resourcesPath, filename) : path.join(__dirname, '..', developmentPath);
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const savedSettings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    const shouldUpgradeFastPreset = (savedSettings.settingsSchemaVersion || 1) < 2 && savedSettings.delayMs === 8;
    settings = { ...DEFAULT_SETTINGS, ...savedSettings, settingsSchemaVersion: 2 };
    if (shouldUpgradeFastPreset) settings.delayMs = 0;
    if ((savedSettings.settingsSchemaVersion || 1) < 2) saveSettings();
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function getLaunchAtLogin() {
  try {
    const status = app.getLoginItemSettings({ path: process.execPath, args: STARTUP_ARGUMENTS });
    return status.openAtLogin && status.executableWillLaunchAtLogin !== false;
  } catch (error) {
    log(`Could not read startup setting: ${error.message}`);
    return Boolean(settings.launchAtLogin);
  }
}

function setLaunchAtLogin(enabled) {
  settings.launchAtLogin = Boolean(enabled);
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
    path: process.execPath,
    args: STARTUP_ARGUMENTS,
    enabled: settings.launchAtLogin,
    name: APP_NAME
  });
}

async function readClipboardText() {
  const value = await clipboard.readText();
  return typeof value === 'string' ? value : '';
}

function log(message) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(app.getPath('userData'), 'typerly.log'), `[${timestamp}] ${message}\n`);
  } catch {
    // Logging must never interrupt typing.
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 390,
    height: 530,
    minWidth: 390,
    minHeight: 530,
    maxWidth: 390,
    maxHeight: 530,
    show: false,
    frame: false,
    transparent: true,
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    icon: resourceFile('icon.ico', path.join('assets', 'icon.ico')),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createCountdownWindow() {
  if (countdownWindow && !countdownWindow.isDestroyed()) return countdownWindow;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  countdownWindow = new BrowserWindow({
    width: 276,
    height: 116,
    x: Math.round(x + width / 2 - 138),
    y: Math.round(y + height - 148),
    show: false,
    frame: false,
    transparent: true,
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'countdown-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  countdownWindow.setIgnoreMouseEvents(true);
  countdownWindow.loadFile(path.join(__dirname, 'renderer', 'countdown.html'), {
    query: { theme: settings.theme, seconds: String(settings.countdownSeconds) }
  });
  countdownWindow.on('closed', () => { countdownWindow = null; });
  return countdownWindow;
}

async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  try {
    const text = await readClipboardText();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clipboard-changed', text);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', updateState);
  } catch (error) {
    log(`Could not read clipboard while opening: ${error.message}`);
  }
}

function registerTypingShortcut(accelerator) {
  const previous = registeredShortcut;
  if (previous) globalShortcut.unregister(previous);

  let registered = false;
  try {
    registered = globalShortcut.register(accelerator, () => beginTyping());
  } catch (error) {
    log(`Shortcut registration failed for ${accelerator}: ${error.message}`);
  }

  if (registered) {
    registeredShortcut = accelerator;
    log(`Shortcut registered: ${accelerator}`);
    return true;
  }

  registeredShortcut = null;
  if (previous) {
    try {
      if (globalShortcut.register(previous, () => beginTyping())) registeredShortcut = previous;
    } catch {
      // The UI will report the failed registration.
    }
  }
  return false;
}

function buildTrayMenu() {
  const template = [];
  if (updateReadyVersion) {
    template.push(
      { label: `Restart to update to v${updateReadyVersion}`, click: installReadyUpdate },
      { type: 'separator' }
    );
  }
  template.push(
    { label: 'Open Typerly', click: showMainWindow },
    { label: 'Type clipboard', enabled: !currentJob, click: () => beginTyping() },
    { label: 'Cancel typing', visible: Boolean(currentJob), click: cancelTyping },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: getLaunchAtLogin(),
      click: (item) => {
        setLaunchAtLogin(item.checked);
        saveSettings();
        mainWindow?.webContents.send('settings-changed', { launchAtLogin: item.checked });
      }
    },
    { label: 'Check for updates', enabled: !updateReadyVersion, click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit Typerly', click: () => { isQuitting = true; app.quit(); } }
  );
  return Menu.buildFromTemplate(template);
}

function createTray() {
  const icon = nativeImage.createFromPath(resourceFile('tray-icon.png', path.join('assets', 'tray-icon.png')));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`${APP_NAME} · Ready`);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  tray.on('balloon-click', () => {
    if (updateReadyVersion) tray.popUpContextMenu();
    else showMainWindow();
  });
}

function emitUpdateStatus(state, version = null, detail = '') {
  updateState = { state, version, detail };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', updateState);
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged || updateReadyVersion) {
    if (manual && !app.isPackaged) emitUpdateStatus('development', app.getVersion());
    return;
  }
  emitUpdateStatus('checking');
  autoUpdater.checkForUpdates().catch((error) => {
    log(`Update check failed: ${error.message}`);
    emitUpdateStatus('error', null, 'Could not check for updates');
    if (manual) tray?.displayBalloon({ title: 'Update check failed', content: 'Typerly could not reach the update server.' });
  });
}

function installReadyUpdate() {
  if (!updateReadyVersion) return;
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
}

function configureAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => log(`Updater: ${message}`),
    warn: (message) => log(`Updater warning: ${message}`),
    error: (message) => log(`Updater error: ${message}`),
    debug: (message) => log(`Updater debug: ${message}`)
  };

  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info.version}`);
    emitUpdateStatus('downloading', info.version);
  });
  autoUpdater.on('update-not-available', (info) => {
    emitUpdateStatus('current', info.version || app.getVersion());
  });
  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus('downloading', updateState.version, `${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReadyVersion = info.version;
    emitUpdateStatus('ready', info.version);
    tray.setContextMenu(buildTrayMenu());
    tray.displayBalloon({
      title: `Typerly ${info.version} is ready`,
      content: 'Restart Typerly to finish the update. It will also install automatically when you quit.'
    });
  });
  autoUpdater.on('error', (error) => {
    log(`Updater error: ${error.message}`);
    emitUpdateStatus('error', null, 'Update check failed');
  });

  setTimeout(() => checkForUpdates(), 10000);
  const updateInterval = setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);
  updateInterval.unref();
}

function setStatus(status, detail = '') {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status-changed', { status, detail });
  if (tray) {
    const tooltip = status === 'ready' ? `${APP_NAME} · Ready` : `${APP_NAME} · ${detail || status}`;
    tray.setToolTip(tooltip);
    tray.setContextMenu(buildTrayMenu());
    if (status === 'error') {
      tray.displayBalloon({ title: 'Typerly couldn’t type', content: detail || 'Open Typerly and try again.' });
    }
  }
}

function startWorker() {
  if (process.platform !== 'win32') return;
  workerReady = false;
  worker = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', app.isPackaged ? path.join(process.resourcesPath, 'typing-worker.ps1') : path.join(__dirname, 'typing-worker.ps1')
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let buffer = '';
  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) handleWorkerMessage(line.trim());
  });
  worker.stderr.setEncoding('utf8');
  worker.stderr.on('data', (message) => log(`Worker error output: ${message.trim()}`));
  worker.on('error', (error) => {
    log(`Worker failed to start: ${error.message}`);
    workerReady = false;
  });
  worker.on('exit', (code) => {
    log(`Worker exited with code ${code}`);
    workerReady = false;
    worker = null;
    if (currentJob?.phase === 'typing') finishJob('cancelled');
    if (!isQuitting) setTimeout(startWorker, 500);
  });
}

function handleWorkerMessage(line) {
  if (line === 'READY') {
    workerReady = true;
    worker.stdin.write(`MONITOR|${process.pid}\n`);
    log('Typing worker ready');
    return;
  }
  const [kind, id, ...rest] = line.split('|');
  if (!currentJob || id !== currentJob.id) return;
  if (kind === 'DONE') finishJob('complete');
  if (kind === 'ERROR') finishJob('error', rest.join('|'));
}

function waitForWorker(timeoutMs = 4000) {
  if (workerReady && worker?.stdin?.writable) return Promise.resolve(true);
  if (!worker) startWorker();
  return new Promise((resolve) => {
    const started = Date.now();
    const check = setInterval(() => {
      if (workerReady && worker?.stdin?.writable) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 50);
  });
}

async function beginTyping(delayMs = settings.delayMs) {
  if (currentJob || startingJob) return { ok: false, reason: 'busy' };
  startingJob = true;
  let text;
  try {
    text = await readClipboardText();
  } catch (error) {
    startingJob = false;
    log(`Typing aborted: could not read clipboard: ${error.message}`);
    setStatus('error', 'Could not read the clipboard');
    return { ok: false, reason: 'clipboard' };
  }
  if (typeof text !== 'string' || text.length === 0) {
    startingJob = false;
    return { ok: false, reason: 'empty' };
  }

  const ready = await waitForWorker();
  if (!ready) {
    startingJob = false;
    log('Typing aborted: helper unavailable');
    setStatus('error', 'Typing helper unavailable');
    return { ok: false, reason: 'worker' };
  }

  const parsedDelay = Number(delayMs);
  settings.delayMs = Number.isFinite(parsedDelay)
    ? Math.max(0, Math.min(1000, Math.round(parsedDelay)))
    : DEFAULT_SETTINGS.delayMs;
  saveSettings();
  currentJob = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, phase: 'countdown', text };
  startingJob = false;
  log(`Typing requested: ${text.length} characters at ${settings.delayMs} ms`);
  const seconds = settings.countdownSeconds;
  setStatus('countdown', seconds > 0 ? `Starting in ${seconds}` : 'Starting');
  if (mainWindow?.isVisible()) mainWindow.minimize();

  const startKeystrokes = () => {
    if (!currentJob || currentJob.phase !== 'countdown') return;
    countdownWindow?.hide();
    currentJob.phase = 'typing';
    setStatus('typing', `Typing ${text.length.toLocaleString()} characters`);
    const payload = Buffer.from(text, 'utf16le').toString('base64');
    worker.stdin.write(`TYPE|${currentJob.id}|${settings.delayMs}|${payload}\n`);
  };

  const skipCountdown = () => {
    if (!currentJob || currentJob.phase !== 'countdown') return;
    clearInterval(countdownTimer);
    countdownTimer = null;
    log('Countdown skipped with Space');
    startKeystrokes();
  };

  globalShortcut.register('Escape', cancelTyping);
  if (seconds > 0 && !globalShortcut.register('Space', skipCountdown)) {
    log('Could not register Space to skip the countdown');
  }

  if (seconds === 0) {
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      startKeystrokes();
    }, 180);
    return { ok: true };
  }

  const overlay = createCountdownWindow();
  overlay.webContents.send('theme-changed', settings.theme);
  overlay.webContents.send('countdown', seconds);
  overlay.showInactive();

  let remaining = seconds;
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (!currentJob) return;
    if (remaining > 0) {
      overlay.webContents.send('countdown', remaining);
      setStatus('countdown', `Starting in ${remaining}`);
      return;
    }

    clearInterval(countdownTimer);
    countdownTimer = null;
    startKeystrokes();
  }, 1000);
  return { ok: true };
}

function finishJob(outcome, detail = '') {
  const finished = currentJob;
  currentJob = null;
  clearInterval(countdownTimer);
  countdownTimer = null;
  globalShortcut.unregister('Escape');
  globalShortcut.unregister('Space');
  countdownWindow?.hide();
  if (outcome === 'complete') setStatus('ready', 'Finished');
  else if (outcome === 'error') setStatus('error', detail || 'Could not type text');
  else setStatus('ready', 'Cancelled');
  log(`Typing ${outcome}${detail ? `: ${detail}` : ''}`);
  mainWindow?.webContents.send('typing-finished', { outcome, characters: finished?.text.length || 0 });
}

function cancelTyping() {
  if (!currentJob) return;
  if (currentJob.phase === 'typing' && worker) {
    worker.kill();
  } else {
    finishJob('cancelled');
  }
}

ipcMain.handle('clipboard:read', () => readClipboardText());
ipcMain.handle('typing:start', (_event, delayMs) => beginTyping(delayMs));
ipcMain.handle('typing:cancel', () => { cancelTyping(); return true; });
ipcMain.handle('settings:get', () => ({
  delayMs: settings.delayMs,
  countdownSeconds: settings.countdownSeconds,
  shortcut: settings.shortcut,
  theme: settings.theme,
  launchAtLogin: getLaunchAtLogin(),
  version: app.getVersion()
}));
ipcMain.handle('settings:set', (_event, next) => {
  let shortcutError = false;
  if (typeof next.delayMs === 'number') settings.delayMs = Math.max(0, Math.min(1000, Math.round(next.delayMs)));
  if (typeof next.countdownSeconds === 'number') {
    settings.countdownSeconds = Math.max(0, Math.min(10, Math.round(next.countdownSeconds)));
  }
  if (next.theme === 'light' || next.theme === 'dark') {
    if (settings.theme !== next.theme && countdownWindow && !currentJob) countdownWindow.destroy();
    settings.theme = next.theme;
    mainWindow?.setBackgroundColor('#00000000');
  }
  if (typeof next.shortcut === 'string' && next.shortcut !== settings.shortcut) {
    if (registerTypingShortcut(next.shortcut)) settings.shortcut = next.shortcut;
    else shortcutError = true;
  }
  if (typeof next.launchAtLogin === 'boolean') {
    setLaunchAtLogin(next.launchAtLogin);
    tray?.setContextMenu(buildTrayMenu());
  }
  saveSettings();
  return { ...settings, shortcutError };
});
ipcMain.handle('shortcut:recording', (_event, recording) => {
  if (recording) {
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
    return true;
  }
  if (!registeredShortcut) return registerTypingShortcut(settings.shortcut);
  return true;
});
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.hide());

app.on('second-instance', showMainWindow);
app.whenReady().then(async () => {
  app.setAppUserModelId('com.typerly.app');
  loadSettings();
  startWorker();
  createMainWindow();
  createTray();
  configureAutoUpdates();

  if (!registerTypingShortcut(settings.shortcut)) {
    settings.shortcut = DEFAULT_SETTINGS.shortcut;
    registerTypingShortcut(settings.shortcut);
    saveSettings();
  }

  const openedHidden = process.argv.includes('--hidden');
  await waitForWorker();
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (!openedHidden) showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  worker?.kill();
});
app.on('window-all-closed', () => {});
