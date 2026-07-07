use base64::{engine::general_purpose, Engine as _};
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use std::io::Cursor;
use xcap::{Monitor, Window};

use crate::active_window::get_active_window_info;

#[tauri::command]
pub async fn capture_screen(mode: String) -> Result<String, String> {
    let mut target_image: Option<DynamicImage> = None;

    if mode == "fullscreen" {
        let monitors = Monitor::all().map_err(|e| format!("failed to list monitors: {}", e))?;
        if let Some(monitor) = monitors.first() {
            let capture = monitor
                .capture_image()
                .map_err(|e| format!("failed to capture monitor: {}", e))?;
            target_image = Some(DynamicImage::ImageRgba8(capture));
        } else {
            return Err("no available monitor found".into());
        }
    } else {
        let active_win =
            get_active_window_info().map_err(|e| format!("failed to get active window: {}", e))?;
        let active_title = active_win.title;
        let active_app_name = active_win.app_name;

        let windows = Window::all().map_err(|e| format!("failed to list windows: {}", e))?;

        for window in windows {
            if window.title().unwrap_or_default() == active_title
                || window.app_name().unwrap_or_default() == active_app_name
            {
                if let Ok(capture) = window.capture_image() {
                    target_image = Some(DynamicImage::ImageRgba8(capture));
                    break;
                }
            }
        }

        if target_image.is_none() {
            return Err("failed to find a matching active window for capture".into());
        }
    }

    if let Some(mut img) = target_image {
        let max_dimension = 1280;
        if img.width() > max_dimension || img.height() > max_dimension {
            img = img.resize(max_dimension, max_dimension, FilterType::Triangle);
        }

        let mut buffer = Cursor::new(Vec::new());
        img.write_to(&mut buffer, ImageFormat::Jpeg)
            .map_err(|e| format!("failed to encode screenshot: {}", e))?;

        Ok(general_purpose::STANDARD.encode(buffer.into_inner()))
    } else {
        Err("screenshot failed with an unknown error".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fullscreen_capture() {
        let result = capture_screen("fullscreen".to_string()).await;
        assert!(
            result.is_ok(),
            "Fullscreen capture failed: {:?}",
            result.err()
        );

        let b64 = result.unwrap();
        assert!(!b64.is_empty(), "Base64 string is empty");

        let bytes = general_purpose::STANDARD
            .decode(&b64)
            .expect("Failed to decode base64");
        std::fs::write("test_screenshot.jpg", &bytes).expect("Failed to write image file");

        let metadata = std::fs::metadata("test_screenshot.jpg").unwrap();
        assert!(
            metadata.len() > 1000,
            "Image size is suspiciously small"
        );
        println!(
            "Successfully captured and saved test_screenshot.jpg, size: {} bytes",
            metadata.len()
        );
    }
}
