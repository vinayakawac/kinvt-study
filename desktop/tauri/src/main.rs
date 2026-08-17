// Kinvt-study — desktop quiz popup
// ---------------------------------------------------------------
// Why this exists as a native app rather than a browser extension: an
// extension cannot draw a window that is transparent, frameless AND outlives
// the browser being minimised. Those are browser-enforced limits, not
// missing features. A native window has none of them.
//
// Rust deliberately owns as little as possible — window/tray/hotkey plumbing
// only. All quiz logic, settings and stats live in the webview (ui/), reusing
// the same card code and question banks the extension used, so there is one
// implementation of the actual product rather than two.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

const QUIZ_WINDOW: &str = "quiz";
const SETTINGS_WINDOW: &str = "settings";

/// Show the quiz window and pull it to the front.
///
/// `set_focus` matters: the window is created with `skip_taskbar` and starts
/// hidden, and on Windows a hidden always-on-top window does not reliably
/// raise itself on `show()` alone.
#[tauri::command]
fn show_quiz(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(QUIZ_WINDOW) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn hide_quiz(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(QUIZ_WINDOW) {
        let _ = win.hide();
    }
}

/// Resize the quiz window to the card's measured height.
///
/// The card's height depends on how long the question and options are, and a
/// transparent window shows its own empty area as a floating rectangle — so a
/// fixed height would leave a visible transparent gap under short questions.
#[tauri::command]
fn resize_quiz(app: tauri::AppHandle, height: f64) {
    if let Some(win) = app.get_webview_window(QUIZ_WINDOW) {
        // Upper bound only guards against a runaway value; a 5-question quiz
        // with explanations legitimately exceeds 900px.
        let clamped = height.clamp(160.0, 1400.0);
        let _ = win.set_size(tauri::LogicalSize::new(412.0, clamped));
    }
}

/// Paint the window's title bar to match the page background.
///
/// A decorated window gets its caption from the OS, so a dark app ends up
/// wearing a light grey title bar with a hard seam across the top. Windows 11
/// (build 22000+) exposes the caption, text and border colours through DWM,
/// which is the only way to match the page exactly — the `theme` window
/// option only picks between the two stock light and dark captions.
///
/// COLORREF is 0x00BBGGRR, not RGB, so the bytes are reversed against the CSS
/// hex: #1c1b19 becomes 0x00191B1C.
///
/// Failures are ignored on purpose. On Windows 10 these attributes are simply
/// unsupported, and a stock title bar is a fine outcome — it must not stop the
/// window from opening.
#[cfg(windows)]
fn paint_titlebar(window: &tauri::WebviewWindow, dark: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0 as _);

    // Mirrors --bg and --text in settings.css.
    let (caption, text) = if dark {
        (0x0019_1B1Cu32, 0x00DD_F1F5u32) // #1c1b19 caption, #f5f1dd text
    } else {
        (0x00DD_F1F5u32, 0x0019_1B1Cu32) // #f5f1dd caption, #1c1b19 text
    };
    let immersive: i32 = i32::from(dark);

    unsafe {
        let attr = |a, ptr: *const std::ffi::c_void, size| {
            let _ = DwmSetWindowAttribute(hwnd, a, ptr, size);
        };
        // Immersive dark mode first: it also darkens the system control
        // glyphs, which the caption colour alone does not touch.
        attr(
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            std::ptr::addr_of!(immersive).cast(),
            4,
        );
        attr(DWMWA_CAPTION_COLOR, std::ptr::addr_of!(caption).cast(), 4);
        attr(DWMWA_TEXT_COLOR, std::ptr::addr_of!(text).cast(), 4);
        attr(DWMWA_BORDER_COLOR, std::ptr::addr_of!(caption).cast(), 4);
    }
}

#[cfg(not(windows))]
fn paint_titlebar(_window: &tauri::WebviewWindow, _dark: bool) {}

/// Called by the settings page whenever the theme changes, so the caption
/// follows the page rather than being painted once at startup and then
/// disagreeing with it.
#[tauri::command]
fn set_titlebar_theme(app: tauri::AppHandle, dark: bool) {
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW) {
        paint_titlebar(&win, dark);
    }
}

/// Whether the OS says now is a bad moment to put a window on screen.
///
/// One call covers every case that matters: fullscreen Direct3D (games),
/// presentation mode, busy or screen-sharing, and Focus Assist quiet time.
/// Anything other than "accepts notifications" means stay out of the way.
///
/// On failure this returns false — allowing the popup. A broken query should
/// not silently disable the whole product.
#[cfg(windows)]
#[tauri::command]
fn dnd_active() -> bool {
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS};
    unsafe {
        match SHQueryUserNotificationState() {
            Ok(state) => state != QUNS_ACCEPTS_NOTIFICATIONS,
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn dnd_active() -> bool {
    false
}

/// Read and write a backup file at a path the user picked.
///
/// Plain std::fs rather than a filesystem plugin: the whole requirement is one
/// read and one write of a path the user has already chosen in a dialog.
#[tauri::command]
fn write_backup(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_backup(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Settings live in their own ordinary window — it wants normal decorations
/// and a solid background, unlike the quiz card.
#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    if let Ok(win) = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW,
        WebviewUrl::App("settings.html".into()),
    )
    .title("Kinvt-study — Settings")
    .inner_size(520.0, 700.0)
    .resizable(true)
    .build()
    {
        // Dark is the app's default theme. The page corrects this over IPC
        // once it has read the stored setting, but painting here first avoids
        // a light caption flashing on every launch.
        paint_titlebar(&win, true);
    }
}

fn main() {
    tauri::Builder::default()
        // A second launch must not start a second copy. Two instances would
        // each own a tray icon, a popup timer and a claim on Ctrl+Shift+Q —
        // the user would see duplicate cards and one instance would silently
        // lose the hotkey. This must be registered before any other plugin so
        // the duplicate exits before it builds a window or tray.
        //
        // The already-running instance gets the callback instead, and treats
        // the relaunch as "show me the settings", which is the only sensible
        // reading of double-clicking an app that is already running.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            open_settings(app.clone());
        }))
        .invoke_handler(tauri::generate_handler![
            show_quiz,
            hide_quiz,
            resize_quiz,
            open_settings,
            set_titlebar_theme,
            dnd_active,
            write_backup,
            read_backup
        ])
        .setup(|app| {
            // ---- system tray ----
            let quiz_now = MenuItem::with_id(app, "quiz_now", "Quiz me now", true, None::<&str>)?;
            let snooze = MenuItem::with_id(app, "snooze", "Snooze 1 hour", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quiz_now, &snooze, &settings, &quit])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or("no default window icon — check bundle.icon in tauri.conf.json")?;

            TrayIconBuilder::with_id("tray")
                .icon(tray_icon)
                .tooltip("Kinvt-study — local quiz, no AI")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quiz_now" => {
                        // The webview owns quiz building, so ask it to start
                        // one rather than duplicating that logic here.
                        let _ = app.emit("start-quiz", ());
                        if let Some(win) = app.get_webview_window(QUIZ_WINDOW) {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    // The webview owns all persisted state, so it records the
                    // snooze rather than Rust keeping a second source of truth.
                    "snooze" => {
                        let _ = app.emit("snooze", ());
                    }
                    "settings" => open_settings(app.clone()),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // ---- global hotkey: Ctrl+Shift+Q from any application ----
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyQ);
                let handle = app.handle().clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, _shortcut, event| {
                            // Fire on press only — without this it triggers
                            // twice per keypress (once on release).
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            let _ = handle.emit("start-quiz", ());
                            if let Some(win) = handle.get_webview_window(QUIZ_WINDOW) {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        })
                        .build(),
                )?;

                if let Err(e) = app.global_shortcut().register(hotkey) {
                    // Another app may already own this combination. Not fatal:
                    // the tray and the interval timer still work.
                    eprintln!("could not register Ctrl+Shift+Q: {e}");
                }
            }

            // Opening the app has to show something. The quiz window is hidden
            // until it has a quiz, and Windows 11 tucks new tray icons into the
            // overflow flyout, so without this a manual launch looks like
            // nothing happened at all.
            open_settings(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the quiz card should put it away, not end the app —
            // it lives in the tray and is expected to come back on schedule.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == QUIZ_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Kinvt-study");
}
