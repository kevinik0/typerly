const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('node:child_process');

let window;
let finished = false;
let shortcutFired = false;

function finish(error) {
  if (finished) return;
  finished = true;
  globalShortcut.unregisterAll();
  if (error) {
    console.error(error instanceof Error ? error.stack : error);
    app.exit(1);
  } else {
    console.log('Space was captured globally without reaching the focused input.');
    app.quit();
  }
}

app.whenReady().then(async () => {
  window = new BrowserWindow({ width: 360, height: 180, show: true });
  await window.loadURL('data:text/html,<input autofocus aria-label="test input">');
  window.show();
  window.focus();
  await window.webContents.executeJavaScript("document.querySelector('input').focus()", true);

  const registered = globalShortcut.register('Space', () => { shortcutFired = true; });
  if (!registered) return finish('Could not register Space as a global shortcut.');

  const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class K { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [K]::keybd_event(32, 0, 0, [UIntPtr]::Zero); [K]::keybd_event(32, 0, 2, [UIntPtr]::Zero)`;
  const sender = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  sender.on('error', finish);
  sender.on('exit', async (code) => {
    if (code !== 0) return finish(`Space key sender exited with code ${code}.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const value = await window.webContents.executeJavaScript("document.querySelector('input').value", true);
    if (!shortcutFired) return finish('The Space shortcut did not fire.');
    if (value !== '') return finish(`Space leaked into the focused input: ${JSON.stringify(value)}`);
    finish();
  });
  setTimeout(() => finish('Space shortcut smoke test timed out.'), 6000).unref();
});
