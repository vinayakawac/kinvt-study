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

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeTheme, shell } = require('electron');
const path = require('path');

const CARD_WIDTH = 400;

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'));
}

// The OS draws the caption, so a dark app otherwise wears a light grey title
// bar with a hard seam across the top. Setting themeSource makes Windows draw
// its dark caption instead, and it follows the page when the theme changes.
//
// This gets close to the page rather than matching it exactly. Electron has no
// route to DWM's caption colour, and the exact-match alternative —
// titleBarStyle 'hidden' with a titleBarOverlay — removes the native caption
// and pushes page content under the window controls, which needs a drag region
// and top clearance the shared stylesheet does not have. The Tauri shell, which
// is the one the README recommends, does match exactly via DWM.
ipcMain.handle('set_titlebar_theme', (_e, { dark }) => {
  nativeTheme.themeSource = dark ? 'dark' : 'light';
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
  app.on('second-instance', () => startQuiz());

  app.whenReady().then(() => {
    createQuizWindow();

    tray = new Tray(path.join(__dirname, 'icons', 'icon.png'));
    tray.setToolTip('Kinvt-study — local quiz, no AI');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Quiz me now', click: startQuiz },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]));
    tray.on('double-click', startQuiz);

    if (!globalShortcut.register('Control+Shift+Q', startQuiz)) {
      // Another app already owns the combination. Not fatal — the tray and
      // the interval timer still work.
      console.warn('Could not register Ctrl+Shift+Q; it is already in use.');
    }
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}
