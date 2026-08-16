/*
 * Kinvt-study — Electron main process.
 *
 * Why a desktop app at all: the popup has to be transparent, frameless,
 * always-on-top AND independent of the browser. A browser extension can't do
 * all four — an extension popup window can't be transparent or lose its title
 * bar, and an in-page overlay dies with its tab. Those are browser security
 * boundaries, not missing features. A native window has none of them.
 *
 * Why Electron rather than Tauri: Tauri would ship ~6MB instead of ~150MB,
 * but it compiles Rust and therefore needs an MSVC linker, which this machine
 * doesn't have. Electron builds with nothing but Node and npm. The Tauri
 * version is kept in tauri/ for anyone who has the toolchain.
 *
 * The main process owns only window/tray/hotkey plumbing; all quiz logic
 * lives in ui/, shared with the Tauri build.
 */
'use strict';

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeTheme, nativeImage } = require('electron');
const path = require('path');

const CARD_WIDTH = 400;

// Mirrors --bg and --text in settings.css, so the caption is the same colour
// as the page rather than merely a dark one.
const OVERLAY_DARK = { color: '#1c1b19', symbolColor: '#f5f1dd', height: 32 };
const OVERLAY_LIGHT = { color: '#f5f1dd', symbolColor: '#1c1b19', height: 32 };

let quizWin = null;
let settingsWin = null;
let tray = null;

function createQuizWindow() {
  quizWin = new BrowserWindow({
    width: CARD_WIDTH,
    height: 460,
    show: false,

    // The three things a browser extension could never give us.
    transparent: true,
    frame: false,
    alwaysOnTop: true,

    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Keep it visible over full-screen apps too, not just normal windows.
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 'screen-saver' outranks ordinary always-on-top windows, which is what
  // "stays put no matter what I'm doing" actually requires.
  quizWin.setAlwaysOnTop(true, 'screen-saver');
  quizWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  quizWin.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Closing the card should put it away, not quit — the app lives in the
  // tray and is expected to come back on schedule.
  quizWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      quizWin.hide();
    }
  });
}

function positionBottomRight(win, width, height) {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(workArea.x + workArea.width - width - 24),
    y: Math.round(workArea.y + workArea.height - height - 24),
    width,
    height
  });
}

function showQuiz() {
  if (!quizWin) return;
  quizWin.showInactive();      // appear without stealing focus from your work
  quizWin.setAlwaysOnTop(true, 'screen-saver');
}

function startQuiz() {
  if (!quizWin) return;
  quizWin.webContents.send('start-quiz');
  showQuiz();
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'Kinvt-study — Settings',
    backgroundColor: '#1c1b19',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    // The OS draws the caption, so a dark app otherwise wears a light grey
    // title bar with a hard seam across the top. An overlay is the only way
    // Electron can colour it exactly; the Tauri shell does the same through
    // DWM. Colours mirror --bg and --text in settings.css.
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: OVERLAY_DARK
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'));

  // Hiding the caption means the page must provide its own drag strip and
  // clearance for the window controls. That is Electron-specific, so the flag
  // is set from the shell rather than baked into the shared stylesheet, which
  // Tauri also loads.
  if (process.platform === 'win32') {
    settingsWin.webContents.on('did-finish-load', () => {
      settingsWin.webContents.executeJavaScript(
        "document.body.classList.add('overlay-titlebar')"
      ).catch(() => {});
    });
  }
}

// The settings page reports its theme so the caption follows it, instead of
// staying dark while the page turns light. setTitleBarOverlay throws if the
// window was built without an overlay, which is every non-Windows platform.
ipcMain.handle('set_titlebar_theme', (_e, { dark }) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  if (process.platform !== 'win32') return;
  if (!settingsWin || settingsWin.isDestroyed()) return;
  try {
    settingsWin.setTitleBarOverlay(dark ? OVERLAY_DARK : OVERLAY_LIGHT);
  } catch (e) { /* no overlay on this window */ }
});

/* ---------- IPC from the webview ---------- */

ipcMain.handle('show_quiz', () => showQuiz());
ipcMain.handle('hide_quiz', () => { if (quizWin) quizWin.hide(); });
ipcMain.handle('open_settings', () => openSettings());

// A transparent window shows its unused area as a floating rectangle, so the
// window has to track the card's real height rather than assume one.
ipcMain.handle('resize_quiz', (_e, { height }) => {
  if (!quizWin) return;
  const h = Math.max(160, Math.min(Math.ceil(height), 900));
  positionBottomRight(quizWin, CARD_WIDTH, h);
});

// Lets the settings window drive the quiz window (they are separate renderers,
// so a plain event bus inside one page would not reach the other).
ipcMain.handle('emit', (_e, name) => {
  if (name === 'start-quiz') startQuiz();
});

/* ---------- lifecycle ---------- */

// A tray app must not quit when its windows are closed.
app.on('window-all-closed', (e) => e.preventDefault());

// Only one instance, or several trays and timers would fight each other.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Relaunching an app that is already running should show its window, not
  // fire a quiz at you — the same thing the Tauri shell does. Without this the
  // second launch would appear to do nothing at all, since the app lives in
  // the tray and its icon is hidden in the Windows 11 overflow flyout.
  app.on('second-instance', () => openSettings());

  app.whenReady().then(() => {
    createQuizWindow();

    // A missing icon must not cost us the tray: without a tray this app has no
    // way to be reached at all — the quiz window is hidden and skips the
    // taskbar, so the process would run completely invisibly. Electron accepts
    // an empty image and still creates a (blank) tray entry, which is far
    // better than throwing out of whenReady and leaving nothing.
    const iconPath = path.join(__dirname, 'icons', 'icon.png');
    try {
      tray = new Tray(iconPath);
    } catch (e) {
      console.error('Tray icon failed to load from ' + iconPath + ': ' + e.message);
      tray = new Tray(nativeImage.createEmpty());
    }
    tray.setToolTip('Kinvt-study — local quiz, no AI');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Quiz me now', click: startQuiz },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
    tray.on('double-click', startQuiz);
    // Single click is what most people try first on Windows.
    tray.on('click', openSettings);

    if (!globalShortcut.register('Control+Shift+Q', startQuiz)) {
      // Another app already owns the combination. Not fatal — the tray and
      // the interval timer still work.
      console.warn('Could not register Ctrl+Shift+Q; it is already in use.');
    }

    // Launching the app has to show something. The quiz window starts hidden
    // and skips the taskbar, and Windows 11 buries new tray icons in the
    // overflow flyout — so without this, double-clicking the exe looks exactly
    // like nothing happened. The Tauri shell already did this; Electron did
    // not, which is why it appeared to run only in the background.
    openSettings();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}
