const { app, clipboard } = require('electron');

const sample = 'Typerly clipboard regression test — 😀';

app.whenReady().then(async () => {
  const previous = await clipboard.readText();
  try {
    clipboard.writeText(sample);
    const actual = await clipboard.readText();
    if (typeof actual !== 'string') throw new Error(`Expected a string, received ${typeof actual}`);
    if (actual !== sample) throw new Error(`Clipboard mismatch: ${JSON.stringify(actual)}`);
    console.log('Async clipboard read returned the expected text.');
  } finally {
    clipboard.writeText(previous);
    app.quit();
  }
});
