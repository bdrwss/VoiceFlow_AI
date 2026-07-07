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
mod audio_manager;
mod screenshot;
pub(crate) mod active_window;

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

    // 强制释放可能卡住的修饰键，防止与输入法或系统快捷键冲突
    enigo.key_up(Key::Control);
    enigo.key_up(Key::Alt);
    enigo.key_up(Key::Shift);
    #[cfg(target_os = "macos")]
    enigo.key_up(Key::Meta);

    // 微小缓冲延时，给系统响应状态变化的时间
    thread::sleep(Duration::from_millis(50));

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 保存原剪贴板内容
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    clipboard.set_text(text).map_err(|e| e.to_string())?;

    // 给系统剪贴板一点时间同步（极度重要，防止粘贴出旧内容）
    thread::sleep(Duration::from_millis(30));

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

    // 给系统一点时间处理粘贴事件 (由 50ms 延长至 200ms，防止部分慢速应用读取到已被恢复的旧剪贴板)
    thread::sleep(Duration::from_millis(200));

    // 恢复原剪贴板内容
    let _ = clipboard.set_text(original_clipboard);

    Ok(())
}

#[tauri::command]
fn replace_with_ai_text(original_len: usize, new_text: String) -> Result<(), String> {
    let mut enigo = Enigo::new();

    // 强制释放可能卡住的修饰键，防止与输入法或系统快捷键冲突
    enigo.key_up(Key::Control);
    enigo.key_up(Key::Alt);
    enigo.key_up(Key::Shift);
    #[cfg(target_os = "macos")]
    enigo.key_up(Key::Meta);

    // 微小缓冲延时
    thread::sleep(Duration::from_millis(30));

    // 1. 逐个删除刚刚打出的原文 (Backspace)
    // 使用 Backspace 比 Shift+LeftArrow 兼容性更好，某些输入框不支持选中后覆盖
    if original_len > 0 {
        for _ in 0..original_len {
            enigo.key_down(Key::Backspace);
            thread::sleep(Duration::from_millis(10));
            enigo.key_up(Key::Backspace);
            thread::sleep(Duration::from_millis(10));
        }
        // 给系统一点时间反应删除完成
        thread::sleep(Duration::from_millis(30));
    }

    // 2. 将 AI 优化后的文本复制到剪贴板并粘贴，瞬时替换
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;

    // 保存原剪贴板内容
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    clipboard.set_text(new_text).map_err(|e| e.to_string())?;

    // 给系统剪贴板一点时间同步（极度重要，防止粘贴出旧内容）
    thread::sleep(Duration::from_millis(30));

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

    // 给系统一点时间处理粘贴事件 (由 50ms 延长至 200ms，防止部分慢速应用读取到已被恢复的旧剪贴板)
    thread::sleep(Duration::from_millis(200));

    // 恢复原剪贴板内容
    let _ = clipboard.set_text(original_clipboard);

    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
struct ShortcutConfig {
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
    main_key: rdev::Key,
}

fn parse_shortcut(s: &str) -> ShortcutConfig {
    let mut config = ShortcutConfig {
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
        main_key: rdev::Key::Unknown(0),
    };

    let parts: Vec<&str> = s.split('+').collect();
    for p in parts {
        match p {
            "Ctrl" => config.ctrl = true,
            "Shift" => config.shift = true,
            "Alt" => config.alt = true,
            "Meta" => config.meta = true,
            _ => config.main_key = string_to_rdev_key(p),
        }
    }
    config
}

fn string_to_rdev_key(s: &str) -> rdev::Key {
    match s {
        "A" => rdev::Key::KeyA,
        "B" => rdev::Key::KeyB,
        "C" => rdev::Key::KeyC,
        "D" => rdev::Key::KeyD,
        "E" => rdev::Key::KeyE,
        "F" => rdev::Key::KeyF,
        "G" => rdev::Key::KeyG,
        "H" => rdev::Key::KeyH,
        "I" => rdev::Key::KeyI,
        "J" => rdev::Key::KeyJ,
        "K" => rdev::Key::KeyK,
        "L" => rdev::Key::KeyL,
        "M" => rdev::Key::KeyM,
        "N" => rdev::Key::KeyN,
        "O" => rdev::Key::KeyO,
        "P" => rdev::Key::KeyP,
        "Q" => rdev::Key::KeyQ,
        "R" => rdev::Key::KeyR,
        "S" => rdev::Key::KeyS,
        "T" => rdev::Key::KeyT,
        "U" => rdev::Key::KeyU,
        "V" => rdev::Key::KeyV,
        "W" => rdev::Key::KeyW,
        "X" => rdev::Key::KeyX,
        "Y" => rdev::Key::KeyY,
        "Z" => rdev::Key::KeyZ,
        "0" => rdev::Key::Num0,
        "1" => rdev::Key::Num1,
        "2" => rdev::Key::Num2,
        "3" => rdev::Key::Num3,
        "4" => rdev::Key::Num4,
        "5" => rdev::Key::Num5,
        "6" => rdev::Key::Num6,
        "7" => rdev::Key::Num7,
        "8" => rdev::Key::Num8,
        "9" => rdev::Key::Num9,
        "SPACE" | "Space" => rdev::Key::Space,
        "RCONTROL" | "RControl" => rdev::Key::ControlRight,
        "LCONTROL" | "LControl" => rdev::Key::ControlLeft,
        "LALT" | "LAlt" => rdev::Key::Alt,
        "RALT" | "RAlt" => rdev::Key::AltGr,
        "CAPSLOCK" | "CapsLock" => rdev::Key::CapsLock,
        "ESCAPE" | "Escape" => rdev::Key::Escape,
        "ENTER" | "Enter" => rdev::Key::Return,
        "TAB" | "Tab" => rdev::Key::Tab,
        "BACKSPACE" | "Backspace" => rdev::Key::Backspace,
        _ => rdev::Key::Unknown(0),
    }
}

// 辅助函数：获取当前活动窗口信息
fn get_active_window_info() -> (Option<String>, Option<String>) {
    match active_window::get_active_window_info() {
        Ok(active_window) => (Some(active_window.app_name), Some(active_window.title)),
        Err(_) => (None, None),
    }
}

#[tauri::command]
fn get_active_window_info_cmd() -> Result<KeyStatePayload, String> {
    let (app_name, window_title) = get_active_window_info();
    Ok(KeyStatePayload {
        pressed: false,
        app_name,
        window_title,
    })
}

struct ModifierState {
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

impl ModifierState {
    fn update(&mut self, key: rdev::Key, pressed: bool) {
        match key {
            rdev::Key::ControlLeft | rdev::Key::ControlRight => self.ctrl = pressed,
            rdev::Key::ShiftLeft | rdev::Key::ShiftRight => self.shift = pressed,
            rdev::Key::Alt | rdev::Key::AltGr => self.alt = pressed,
            rdev::Key::MetaLeft | rdev::Key::MetaRight => self.meta = pressed,
            _ => {}
        }
    }
    
    fn matches(&self, config: &ShortcutConfig) -> bool {
        self.ctrl == config.ctrl &&
        self.shift == config.shift &&
        self.alt == config.alt &&
        self.meta == config.meta
    }
}

// 全局按键监听线程 (使用 rdev 事件驱动)
fn start_key_listener(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut is_recording_triggered = false;
        let mut mods = ModifierState { ctrl: false, shift: false, alt: false, meta: false };
        let mut main_key_pressed = false;

        let callback = move |event: Event| {
            let (target_key_str, blacklist) =
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let key = state.listen_key.read().unwrap().clone();
                    let bl = state.blacklist.read().unwrap().clone();
                    (key, bl)
                } else {
                    ("RControl".to_string(), vec![])
                };

            let config = parse_shortcut(&target_key_str);

            match event.event_type {
                EventType::KeyPress(key) => {
                    mods.update(key, true);
                    
                    if key == config.main_key {
                        main_key_pressed = true;
                    }

                    // 触发条件：没有触发录音，并且 (修饰键完全匹配 且 主键被按下)
                    if !is_recording_triggered && mods.matches(&config) && main_key_pressed {
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
                            is_recording_triggered = true;
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
                        is_recording_triggered = true;
                    }
                }
                EventType::KeyRelease(key) => {
                    mods.update(key, false);
                    
                    if key == config.main_key {
                        main_key_pressed = false;
                    }

                    // 结束条件：只要处于录音状态，并且当前状态不再完全匹配 (主键松开或者任意所需修饰键松开)
                    if is_recording_triggered {
                        if !main_key_pressed || !mods.matches(&config) {
                            info!("Shortcut released event emitted!");
                            let _ = app_handle.emit(
                                "shortcut-state",
                                KeyStatePayload {
                                    pressed: false,
                                    app_name: None,
                                    window_title: None,
                                },
                            );
                            is_recording_triggered = false;
                        }
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            listen_key: RwLock::new("RControl".to_string()),
            blacklist: RwLock::new(vec![]),
        })
        .manage(audio_manager::AudioState::new())
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "唤出主界面", true, None::<&str>)?;
            let history_i = MenuItem::with_id(app, "history", "历史记录", true, None::<&str>)?;
            let settings_i = MenuItem::with_id(app, "settings", "偏好设置", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &history_i, &settings_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" | "history" | "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = app.emit(event.id.as_ref(), ());
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
            get_active_window_info_cmd,
            screenshot::capture_screen,
            sensevoice::check_sensevoice_ready,
            sensevoice::download_sensevoice,
            sensevoice::force_redownload_sensevoice,
            sensevoice::transcribe_sensevoice,
            audio_manager::duck_system_audio,
            audio_manager::restore_system_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
