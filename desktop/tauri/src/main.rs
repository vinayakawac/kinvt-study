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
        let clamped = height.clamp(160.0, 900.0);
        let _ = win.set_size(tauri::LogicalSize::new(412.0, clamped));
    }
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
    let _ = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW,
        WebviewUrl::App("settings.html".into()),
    )
    .title("Kinvt-study — Settings")
    .inner_size(520.0, 700.0)
    .resizable(true)
    .build();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            show_quiz,
            hide_quiz,
            resize_quiz,
            open_settings
        ])
        .setup(|app| {
            // ---- system tray ----
            let quiz_now = MenuItem::with_id(app, "quiz_now", "Quiz me now", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quiz_now, &settings, &quit])?;

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
