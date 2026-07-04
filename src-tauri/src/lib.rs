use active_win_pos_rs::get_active_window;
use arboard::Clipboard;
use enigo::{Enigo, Key, KeyboardControllable};
use log::{error, info};
use rdev::{listen, Event, EventType};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

mod sensevoice;

// 全局监听键配置与黑名单配置
struct AppState {
    listen_key: RwLock<String>,
    blacklist: RwLock<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone)]
struct KeyStatePayload {
    pressed: bool,
    app_name: Option<String>,
    window_title: Option<String>,
}

#[tauri::command]
fn set_listen_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let mut listen_key = state.listen_key.write().map_err(|e| e.to_string())?;
    *listen_key = key;
    Ok(())
}

#[tauri::command]
fn set_blacklist(state: State<'_, AppState>, blacklist: Vec<String>) -> Result<(), String> {
    let mut bl = state.blacklist.write().map_err(|e| e.to_string())?;
    *bl = blacklist;
    Ok(())
}

#[tauri::command]
fn simulate_typing(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new();
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 保存原剪贴板内容
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    clipboard.set_text(text).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Control);
    }

    // 给系统一点时间处理粘贴事件
    thread::sleep(Duration::from_millis(50));

    // 恢复原剪贴板内容
    let _ = clipboard.set_text(original_clipboard);

    Ok(())
}

#[tauri::command]
fn replace_with_ai_text(original_len: usize, new_text: String) -> Result<(), String> {
    let mut enigo = Enigo::new();

    // 1. 选中刚刚打出的原文 (Shift + LeftArrow)
    // 使用全选覆盖的方式，速度更快且对 Ctrl+Z 撤销更友好
    if original_len > 0 {
        enigo.key_down(Key::Shift);
        for _ in 0..original_len {
            enigo.key_click(Key::LeftArrow);
        }
        enigo.key_up(Key::Shift);
        // 给系统一点时间反应选中文本
        thread::sleep(Duration::from_millis(20));
    }

    // 2. 将 AI 优化后的文本复制到剪贴板并粘贴，瞬时替换
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 保存原剪贴板内容
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    clipboard.set_text(new_text).map_err(|e| e.to_string())?;

    // 模拟 Ctrl + V 粘贴（Windows/Linux 常用，Mac 为 Cmd + V）
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Control);
    }

    // 给系统一点时间处理粘贴事件
    thread::sleep(Duration::from_millis(50));

    // 恢复原剪贴板内容
    let _ = clipboard.set_text(original_clipboard);

    Ok(())
}

// 辅助函数：根据目标字符串映射到 rdev::Key
fn map_target_key(s: &str) -> rdev::Key {
    match s {
        "RControl" => rdev::Key::ControlRight,
        "LControl" => rdev::Key::ControlLeft,
        "LAlt" => rdev::Key::Alt,
        "RAlt" => rdev::Key::AltGr,
        "CapsLock" => rdev::Key::CapsLock,
        _ => rdev::Key::ControlRight, // 默认 fallback
    }
}

// 辅助函数：获取当前活动窗口信息
fn get_active_window_info() -> (Option<String>, Option<String>) {
    match get_active_window() {
        Ok(active_window) => (Some(active_window.app_name), Some(active_window.title)),
        Err(()) => (None, None),
    }
}

// 全局按键监听线程 (使用 rdev 事件驱动)
fn start_key_listener(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut last_state = false;

        // rdev::listen 会阻塞当前线程
        let callback = move |event: Event| {
            let (target_key_str, blacklist) =
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let key = state.listen_key.read().unwrap().clone();
                    let bl = state.blacklist.read().unwrap().clone();
                    (key, bl)
                } else {
                    ("RControl".to_string(), vec![])
                };

            let target_key = map_target_key(&target_key_str);

            match event.event_type {
                EventType::KeyPress(key) if key == target_key => {
                    if !last_state {
                        let (app_name, window_title) = get_active_window_info();

                        // 黑名单拦截判定
                        let is_blocked = if let Some(ref app) = app_name {
                            blacklist
                                .iter()
                                .any(|b| app.to_lowercase().contains(&b.to_lowercase()))
                        } else {
                            false
                        };

                        if is_blocked {
                            info!("Shortcut blocked due to blacklist. App: {:?}", app_name);
                            last_state = true;
                            return;
                        }

                        info!("Shortcut pressed event emitted! App: {:?}", app_name);
                        let _ = app_handle.emit(
                            "shortcut-state",
                            KeyStatePayload {
                                pressed: true,
                                app_name,
                                window_title,
                            },
                        );
                        last_state = true;
                    }
                }
                EventType::KeyRelease(key) if key == target_key => {
                    if last_state {
                        info!("Shortcut released event emitted!");
                        let _ = app_handle.emit(
                            "shortcut-state",
                            KeyStatePayload {
                                pressed: false,
                                app_name: None,
                                window_title: None,
                            },
                        );
                        last_state = false;
                    }
                }
                _ => {}
            }
        };

        if let Err(error) = listen(callback) {
            error!("Error in key listener: {:?}", error);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init(); // 初始化日志

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            listen_key: RwLock::new("RControl".to_string()),
            blacklist: RwLock::new(vec![]),
        })
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "唤出控制面板", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 启动快捷键监听后台线程
            start_key_listener(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close(); // 阻止默认关闭，保持后台运行
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            set_listen_key,
            set_blacklist,
            simulate_typing,
            replace_with_ai_text,
            sensevoice::check_sensevoice_ready,
            sensevoice::download_sensevoice,
            sensevoice::force_redownload_sensevoice,
            sensevoice::transcribe_sensevoice
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
