const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'artifacts', 'typerly-ui.png');
const settingsOutput = path.join(root, 'artifacts', 'typerly-settings.png');
const darkSettingsOutput = path.join(root, 'artifacts', 'typerly-settings-dark.png');
const countdownOutput = path.join(root, 'artifacts', 'typerly-countdown.png');
let mockSettings = { delayMs: 30, countdownSeconds: 3, shortcut: 'Control+Alt+T', theme: 'light', launchAtLogin: false, version: '1.3.0' };

ipcMain.handle('clipboard:read', async () => 'A quiet little utility that turns your clipboard into real keystrokes.');
ipcMain.handle('settings:get', () => mockSettings);
ipcMain.handle('settings:set', (_event, settings) => {
  mockSettings = { ...mockSettings, ...settings };
  return { ...mockSettings, shortcutError: false };
});
ipcMain.handle('shortcut:recording', () => true);
ipcMain.handle('typing:start', () => ({ ok: true }));
ipcMain.handle('typing:cancel', () => true);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 390,
    height: 530,
    show: false,
    frame: false,
    backgroundColor: '#cbd9ef',
    webPreferences: {
      preload: path.join(root, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  window.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await window.webContents.executeJavaScript(`(() => {
    const button = document.getElementById('typeButton');
    return { disabled: button.disabled, opacity: getComputedStyle(button).opacity, background: getComputedStyle(button).backgroundImage };
  })()`, true);
  console.log(`UI state: ${JSON.stringify(state)}`);
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
  console.log(output);
  await window.webContents.executeJavaScript("document.getElementById('settingsButton').click()", true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const viewState = await window.webContents.executeJavaScript(`JSON.stringify({
    main: document.getElementById('mainView').className,
    settings: document.getElementById('settingsView').className,
    button: document.getElementById('settingsButton').className
  })`, true);
  console.log(`Settings view state: ${viewState}`);
  const settingsImage = await window.webContents.capturePage();
  fs.writeFileSync(settingsOutput, settingsImage.toPNG());
  console.log(settingsOutput);

  await window.webContents.executeJavaScript("document.getElementById('launchAtLoginToggle').click()", true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startupEnabled = await window.webContents.executeJavaScript("document.getElementById('launchAtLoginToggle').checked", true);
  if (!startupEnabled || !mockSettings.launchAtLogin) throw new Error('Startup toggle failed.');
  console.log('Startup toggle state: enabled');

  await window.webContents.executeJavaScript("document.querySelector('[data-theme-value=dark]').click()", true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const activeTheme = await window.webContents.executeJavaScript("document.documentElement.dataset.theme", true);
  if (activeTheme !== 'dark') throw new Error(`Theme switch failed: ${activeTheme}`);
  const darkStyle = await window.webContents.executeJavaScript(`(() => {
    const root = getComputedStyle(document.documentElement);
    const shell = getComputedStyle(document.querySelector('.app-shell'));
    return { shellVariable: root.getPropertyValue('--shell'), textVariable: root.getPropertyValue('--text'), color: shell.color, background: shell.backgroundImage };
  })()`, true);
  console.log(`Dark theme style: ${JSON.stringify(darkStyle)}`);
  const darkSettingsImage = await window.webContents.capturePage();
  fs.writeFileSync(darkSettingsOutput, darkSettingsImage.toPNG());
  console.log(darkSettingsOutput);

  await window.webContents.executeJavaScript(`(() => {
    document.getElementById('shortcutRecorder').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Y', ctrlKey: true, shiftKey: true, bubbles: true }));
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const shortcut = await window.webContents.executeJavaScript("document.getElementById('shortcutKeys').textContent", true);
  if (shortcut !== 'Ctrl + Shift + Y') throw new Error(`Shortcut recorder failed: ${shortcut}`);
  console.log(`Shortcut recorder state: ${shortcut}`);

  const customSpeed = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('settingsButton').click();
    document.getElementById('customPaceButton').click();
    const input = document.getElementById('customSpeedInput');
    input.value = '73';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { value: input.value, hidden: document.getElementById('customSpeedField').classList.contains('hidden') };
  })()`, true);
  if (customSpeed.value !== '73' || customSpeed.hidden) throw new Error(`Custom speed control failed: ${JSON.stringify(customSpeed)}`);
  console.log(`Custom speed state: ${JSON.stringify(customSpeed)}`);

  window.setSize(276, 116);
  await window.loadFile(path.join(root, 'src', 'renderer', 'countdown.html'), { query: { theme: 'light', seconds: '3' } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const countdownImage = await window.webContents.capturePage();
  fs.writeFileSync(countdownOutput, countdownImage.toPNG());
  console.log(countdownOutput);
  app.quit();
});
