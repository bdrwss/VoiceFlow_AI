#[derive(Debug, Clone)]
pub(crate) struct ActiveWindowInfo {
    pub(crate) app_name: String,
    pub(crate) title: String,
}

#[cfg(target_os = "windows")]
pub(crate) fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return Err("no foreground window".to_string());
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let app_name = if pid == 0 {
            String::new()
        } else {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                .map_err(|e| e.to_string())?;
            let mut path_buf = [0u16; 1024];
            let mut path_len = path_buf.len() as u32;
            let query_result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(path_buf.as_mut_ptr()),
                &mut path_len,
            );
            let _ = CloseHandle(handle);

            match query_result {
                Ok(()) => {
                    let process_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    Path::new(&process_path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or(&process_path)
                        .to_string()
                }
                Err(_) => String::new(),
            }
        };

        Ok(ActiveWindowInfo { app_name, title })
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn get_active_window_info() -> Result<ActiveWindowInfo, String> {
    Err("active window detection is only enabled on Windows builds".to_string())
}
