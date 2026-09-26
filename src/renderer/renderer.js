const preview = document.getElementById('clipboardPreview');
const characterCount = document.getElementById('characterCount');
const typeButton = document.getElementById('typeButton');
const refreshButton = document.getElementById('refreshButton');
const paceDescription = document.getElementById('paceDescription');
const paceButtons = [...document.querySelectorAll('[data-delay]')];
const customPaceButton = document.getElementById('customPaceButton');
const customSpeedField = document.getElementById('customSpeedField');
const customSpeedInput = document.getElementById('customSpeedInput');
const settingsButton = document.getElementById('settingsButton');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const countdownInput = document.getElementById('countdownInput');
const countdownLabel = document.getElementById('countdownLabel');
const launchAtLoginToggle = document.getElementById('launchAtLoginToggle');
const themeButtons = [...document.querySelectorAll('[data-theme-value]')];
const shortcutRecorder = document.getElementById('shortcutRecorder');
const shortcutKeys = document.getElementById('shortcutKeys');
const shortcutHint = document.getElementById('shortcutHint');
const toast = document.getElementById('toast');
const appVersion = document.getElementById('appVersion');

let clipboardText = '';
let selectedDelay = 30;
let currentSettings = {};
let isBusy = false;
let isRecordingShortcut = false;
let pollTimer;
let speedSaveTimer;

const paceNames = { 55: 'Slow', 30: 'Natural', 0: 'Fast' };

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function setClipboard(text) {
  clipboardText = typeof text === 'string' ? text : '';
  const normalized = clipboardText.trim();
  preview.textContent = normalized || 'Copy some text to get started.';
  preview.classList.toggle('empty', !normalized);
  characterCount.textContent = `${clipboardText.length.toLocaleString()} ${clipboardText.length === 1 ? 'character' : 'characters'}`;
  typeButton.disabled = !clipboardText || isBusy;
}

async function refreshClipboard(animate = false) {
  setClipboard(await window.typerly.readClipboard());
  if (animate) {
    refreshButton.classList.remove('spin');
    requestAnimationFrame(() => refreshButton.classList.add('spin'));
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function setPace(delay, custom = false, persist = true) {
  selectedDelay = clampNumber(delay, 0, 1000, 30);
  const isPreset = !custom && Object.hasOwn(paceNames, selectedDelay);
  paceButtons.forEach((button) => button.classList.toggle('selected', isPreset && Number(button.dataset.delay) === selectedDelay));
  customPaceButton.classList.toggle('selected', !isPreset);
  customSpeedField.classList.toggle('hidden', isPreset);
  paceDescription.classList.toggle('hidden', !isPreset);
  customSpeedInput.value = String(selectedDelay);
  paceDescription.textContent = `${paceNames[selectedDelay] || 'Custom'} · ${selectedDelay} ms`;
  if (persist) window.typerly.setSettings({ delayMs: selectedDelay });
}

function applyTheme(theme, persist = true) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalized;
  themeButtons.forEach((button) => button.classList.toggle('selected', button.dataset.themeValue === normalized));
  currentSettings.theme = normalized;
  if (persist) window.typerly.setSettings({ theme: normalized });
}

function setCountdown(value, persist = true) {
  const seconds = clampNumber(value, 0, 10, 3);
  countdownInput.value = String(seconds);
  countdownLabel.textContent = seconds === 0 ? 'Starts immediately' : `Starts in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  currentSettings.countdownSeconds = seconds;
  if (persist) window.typerly.setSettings({ countdownSeconds: seconds });
}

function displayShortcut(shortcut) {
  return shortcut.split('+').map((part) => part === 'Control' ? 'Ctrl' : part).join(' + ');
}

function renderShortcut(shortcut) {
  const parts = displayShortcut(shortcut).split(' + ');
  shortcutKeys.textContent = parts.join(' + ');
  shortcutHint.replaceChildren();
  parts.forEach((part, index) => {
    if (index > 0) {
      const plus = document.createElement('b');
      plus.textContent = '+';
      shortcutHint.append(plus);
    }
    const key = document.createElement('kbd');
    key.textContent = part;
    shortcutHint.append(key);
  });
  shortcutHint.append(document.createTextNode(' anywhere'));
}

async function stopShortcutRecording() {
  if (!isRecordingShortcut) return;
  isRecordingShortcut = false;
  shortcutRecorder.classList.remove('recording');
  shortcutRecorder.querySelector('small').textContent = 'Click to change';
  renderShortcut(currentSettings.shortcut);
  await window.typerly.setShortcutRecording(false);
}

async function toggleSettings() {
  const opening = settingsView.classList.contains('hidden');
  if (!opening) await stopShortcutRecording();
  settingsView.classList.toggle('hidden', !opening);
  mainView.classList.toggle('hidden', opening);
  settingsButton.classList.toggle('active', opening);
  settingsButton.setAttribute('aria-label', opening ? 'Close settings' : 'Open settings');
}

typeButton.addEventListener('click', async () => {
  if (!clipboardText || isBusy) return;
  isBusy = true;
  typeButton.disabled = true;
  const result = await window.typerly.startTyping(selectedDelay);
  if (!result.ok) {
    isBusy = false;
    typeButton.disabled = !clipboardText;
    if (result.reason === 'empty') showToast('Your clipboard is empty');
    else if (result.reason === 'clipboard') showToast('Could not read your clipboard');
    else if (result.reason === 'worker') showToast('Typing helper could not start');
    else showToast('Typerly is already busy');
  }
});

refreshButton.addEventListener('click', () => refreshClipboard(true));
paceButtons.forEach((button) => button.addEventListener('click', () => setPace(Number(button.dataset.delay))));
customPaceButton.addEventListener('click', () => {
  setPace(selectedDelay, true);
  customSpeedInput.focus();
  customSpeedInput.select();
});
customSpeedInput.addEventListener('input', () => {
  selectedDelay = clampNumber(customSpeedInput.value, 0, 1000, selectedDelay);
  clearTimeout(speedSaveTimer);
  speedSaveTimer = setTimeout(() => window.typerly.setSettings({ delayMs: selectedDelay }), 180);
});
customSpeedInput.addEventListener('blur', () => setPace(customSpeedInput.value, true));

settingsButton.addEventListener('click', toggleSettings);
themeButtons.forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeValue)));
countdownInput.addEventListener('change', () => setCountdown(countdownInput.value));
launchAtLoginToggle.addEventListener('change', async () => {
  const result = await window.typerly.setSettings({ launchAtLogin: launchAtLoginToggle.checked });
  currentSettings.launchAtLogin = Boolean(result.launchAtLogin);
  launchAtLoginToggle.checked = currentSettings.launchAtLogin;
  showToast(currentSettings.launchAtLogin ? 'Opens with Windows' : 'Startup disabled');
});

shortcutRecorder.addEventListener('click', async () => {
  if (isRecordingShortcut) return;
  isRecordingShortcut = true;
  await window.typerly.setShortcutRecording(true);
  shortcutRecorder.classList.add('recording');
  shortcutKeys.textContent = 'Press a shortcut…';
  shortcutRecorder.querySelector('small').textContent = 'Listening';
});

document.addEventListener('keydown', async (event) => {
  if (!isRecordingShortcut) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    await stopShortcutRecording();
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');

  const aliases = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  let key = aliases[event.key] || event.key;
  if (key.length === 1) key = key.toUpperCase();
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key);
  if ((!/^[A-Z0-9]$/.test(key) && !isFunctionKey && !Object.values(aliases).includes(key)) || (modifiers.length === 0 && !isFunctionKey)) {
    showToast('Use a modifier with a letter, number, arrow, or Space');
    return;
  }

  const shortcut = [...modifiers, key].join('+');
  const result = await window.typerly.setSettings({ shortcut });
  if (result.shortcutError) {
    showToast('That shortcut is already in use');
  } else {
    currentSettings.shortcut = result.shortcut;
    renderShortcut(result.shortcut);
    showToast('Shortcut updated');
  }
  await stopShortcutRecording();
});

document.getElementById('closeButton').addEventListener('click', async () => {
  await stopShortcutRecording();
  window.typerly.close();
});

window.typerly.onClipboardChanged(setClipboard);
window.typerly.onStatusChanged(({ status, detail }) => {
  if (status === 'error') showToast(detail || 'Something went wrong');
});
window.typerly.onSettingsChanged(({ launchAtLogin }) => {
  if (typeof launchAtLogin !== 'boolean') return;
  currentSettings.launchAtLogin = launchAtLogin;
  launchAtLoginToggle.checked = launchAtLogin;
});
window.typerly.onTypingFinished(({ outcome, characters }) => {
  isBusy = false;
  typeButton.disabled = !clipboardText;
  if (outcome === 'complete') showToast(`Typed ${characters.toLocaleString()} characters`);
  if (outcome === 'cancelled') showToast('Typing cancelled');
  if (outcome === 'error') showToast('Something interrupted typing');
});
window.typerly.onUpdateStatus(({ state, version }) => {
  if (state === 'ready') showToast(`Update ${version} is ready · restart from the tray`);
  if (state === 'current') showToast('Typerly is up to date');
  if (state === 'error') showToast('Could not check for updates');
});

window.addEventListener('focus', () => {
  refreshClipboard();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshClipboard, 800);
});
window.addEventListener('blur', () => clearInterval(pollTimer));

(async () => {
  currentSettings = await window.typerly.getSettings();
  appVersion.textContent = `Version ${currentSettings.version} · updates automatically`;
  applyTheme(currentSettings.theme, false);
  setCountdown(currentSettings.countdownSeconds, false);
  launchAtLoginToggle.checked = Boolean(currentSettings.launchAtLogin);
  setPace(Number(currentSettings.delayMs), !Object.hasOwn(paceNames, Number(currentSettings.delayMs)), false);
  renderShortcut(currentSettings.shortcut);
  await refreshClipboard();
})();
