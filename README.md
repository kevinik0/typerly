# Typerly

Typerly is a small Windows tray utility that turns clipboard text into real keyboard input. Review the clipboard preview and choose **Type**. The window minimizes, the countdown appears, and Typerly returns to the previous app before typing.

## Run locally

```powershell
npm install
npm start
```

## Build the Windows installer

```powershell
npm run dist
```

The installer is written to `dist/`. Typerly does not send clipboard contents anywhere; text remains on the device and is passed directly to the Windows input API.

If typing fails, diagnostics are saved locally to `%APPDATA%\typerly\typerly.log`.

## Updates

Installed builds check GitHub Releases shortly after launch and every four hours. Updates download quietly in the background and install when Typerly exits. When an update is ready, the tray menu also offers **Restart to update**.

Maintainers can publish a new release by updating the version, committing, and pushing a matching `v*` tag. The GitHub Actions workflow builds the NSIS installer and update metadata automatically.

## Controls

- Click the tray icon to open Typerly.
- Press the configured shortcut anywhere to type the current clipboard after the countdown.
- Press `Space` during the countdown to start typing immediately.
- Press `Esc` during the countdown or while typing to cancel.
- Closing the window keeps Typerly running in the tray. Use **Quit Typerly** in the tray menu to exit completely.
- Open Settings to customize the global shortcut, countdown, theme, startup behavior, and choose any key delay from 0–1000 ms.
