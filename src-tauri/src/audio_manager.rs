use std::sync::Mutex;
use tauri::State;

#[cfg(target_os = "windows")]
use windows::core::Result as WinResult;
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eConsole, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
};
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

pub struct AudioState {
    pub original_volume: Mutex<Option<f32>>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            original_volume: Mutex::new(None),
        }
    }
}

#[cfg(target_os = "windows")]
struct ComGuard(bool);

#[cfg(target_os = "windows")]
impl ComGuard {
    fn new() -> Self {
        unsafe {
            // Use Multithreaded Apartment (MTA) to avoid hanging on thread pools without message pumps
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            // hr.is_ok() returns true for S_OK and S_FALSE. 
            // In both cases, CoUninitialize must be called to balance it.
            ComGuard(hr.is_ok())
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn get_audio_endpoint_volume() -> WinResult<IAudioEndpointVolume> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device: IMMDevice = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let endpoint_volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
    Ok(endpoint_volume)
}

#[tauri::command]
pub fn duck_system_audio(state: State<'_, AudioState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _com_guard = ComGuard::new();
        unsafe {
            if let Ok(endpoint_volume) = get_audio_endpoint_volume() {
                if let Ok(current_volume) = endpoint_volume.GetMasterVolumeLevelScalar() {
                    let mut original = state.original_volume.lock().unwrap();
                    if original.is_none() {
                        *original = Some(current_volume);
                    }
                    
                    let target_volume = 0.05;
                    if current_volume > target_volume {
                        let _ = endpoint_volume.SetMasterVolumeLevelScalar(target_volume, std::ptr::null());
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn restore_system_audio(state: State<'_, AudioState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut original = state.original_volume.lock().unwrap();
        if let Some(vol) = *original {
            let _com_guard = ComGuard::new();
            unsafe {
                if let Ok(endpoint_volume) = get_audio_endpoint_volume() {
                    let _ = endpoint_volume.SetMasterVolumeLevelScalar(vol, std::ptr::null());
                }
            }
            *original = None;
        }
    }
    Ok(())
}
