const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const expected = 'Typerly test — café 😀\r\nLine two';
let worker;

function fail(error) {
  console.error(error instanceof Error ? error.stack : error);
  worker?.kill();
  app.exit(1);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 500, height: 260, show: true });
  await window.loadURL(`data:text/html,<textarea autofocus style="width:90vw;height:70vh;font-size:20px"></textarea>`);
  window.show();
  window.moveTop();
  window.focus();
  await window.webContents.executeJavaScript("document.querySelector('textarea').focus()", true);
  const nativeHandle = window.getNativeWindowHandle().readBigUInt64LE().toString();

  worker = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, '..', 'src', 'typing-worker.ps1')
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', async (chunk) => {
    output += chunk;
    const lines = output.split(/\r?\n/);
    output = lines.pop();
    for (const line of lines) {
      if (line.trim() === 'READY') {
        worker.stdin.write('MONITOR|0\n');
        worker.stdin.write(`TYPEAT|focus|0|${nativeHandle}|\n`);
      }
      if (line.trim() === 'DONE|focus') {
        const payload = Buffer.from(expected, 'utf16le').toString('base64');
        setTimeout(() => worker.stdin.write(`TYPE|smoke|8|${payload}\n`), 250);
      }
      if (line.trim() === 'DONE|smoke') {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const actual = await window.webContents.executeJavaScript("document.querySelector('textarea').value", true);
        if (actual !== expected.replace('\r\n', '\n')) return fail(`Typed text mismatch:\n${JSON.stringify(actual)}`);
        console.log(`Typed ${[...actual].length} characters successfully, including Unicode and a line break.`);
        worker.kill();
        app.quit();
      }
      if (line.startsWith('ERROR|smoke|')) fail(line);
    }
  });
  worker.stderr.on('data', (data) => fail(data.toString()));
  setTimeout(() => fail('Typing smoke test timed out.'), 12000).unref();
});
