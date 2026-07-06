use xcap::{Monitor, Window};
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use base64::{engine::general_purpose, Engine as _};
use std::io::Cursor;

use active_win_pos_rs::get_active_window;

#[tauri::command]
pub async fn capture_screen(mode: String) -> Result<String, String> {
    let mut target_image: Option<DynamicImage> = None;

    if mode == "fullscreen" {
        let monitors = Monitor::all().map_err(|e| format!("获取显示器失败: {}", e))?;
        if let Some(monitor) = monitors.first() {
            let capture = monitor.capture_image().map_err(|e| format!("截取显示器失败: {}", e))?;
            target_image = Some(DynamicImage::ImageRgba8(capture));
        } else {
            return Err("未找到可用显示器".into());
        }
    } else {
        // window mode
        let active_win = get_active_window().map_err(|_| "无法获取当前活动窗口信息")?;
        let active_title = active_win.title;
        let active_app_name = active_win.app_name;

        let windows = Window::all().map_err(|e| format!("获取窗口列表失败: {}", e))?;
        
        for w in windows {
            if w.title().unwrap_or_default() == active_title || w.app_name().unwrap_or_default() == active_app_name {
                if let Ok(capture) = w.capture_image() {
                    target_image = Some(DynamicImage::ImageRgba8(capture));
                    break;
                }
            }
        }
        
        if target_image.is_none() {
            return Err("未找到匹配的活动窗口进行截图".into());
        }
    }

    if let Some(mut img) = target_image {
        let max_dimension = 1280;
        if img.width() > max_dimension || img.height() > max_dimension {
            img = img.resize(max_dimension, max_dimension, FilterType::Triangle);
        }

        let mut buffer = Cursor::new(Vec::new());
        img.write_to(&mut buffer, ImageFormat::Jpeg)
            .map_err(|e| format!("图片编码失败: {}", e))?;
        
        let base64_string = general_purpose::STANDARD.encode(buffer.into_inner());
        Ok(base64_string)
    } else {
        Err("截图失败：未知错误".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fullscreen_capture() {
        let result = capture_screen("fullscreen".to_string()).await;
        assert!(result.is_ok(), "Fullscreen capture failed: {:?}", result.err());
        
        let b64 = result.unwrap();
        assert!(!b64.is_empty(), "Base64 string is empty");
        
        // Decode to ensure valid image
        let bytes = general_purpose::STANDARD.decode(&b64).expect("Failed to decode base64");
        std::fs::write("test_screenshot.jpg", &bytes).expect("Failed to write image file");
        
        let metadata = std::fs::metadata("test_screenshot.jpg").unwrap();
        assert!(metadata.len() > 1000, "Image size is suspiciously small");
        println!("Successfully captured and saved test_screenshot.jpg, size: {} bytes", metadata.len());
    }
}
