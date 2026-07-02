use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use bzip2::read::BzDecoder;
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

const ENGINE_DIR: &str = "sherpa-onnx-v1.10.33-win-x64-static";
const ENGINE_READY_FILE: &str = "bin/sherpa-onnx-offline.exe";
const PRIMARY_MODEL_DIR: &str = "sensevoice-small-modelscope-int8";
const PRIMARY_MODEL_FILE: &str = "model.int8.onnx";
const PRIMARY_MODEL_SIZE: u64 = 239_233_841;
const PRIMARY_TOKENS_SIZE: u64 = 315_894;
const MANYEYES_MODEL_DIR: &str = "sensevoice-small-modelscope-fp32";
const MANYEYES_MODEL_FILE: &str = "model.onnx";
const MANYEYES_MODEL_SIZE: u64 = 936_745_991;
const MANYEYES_TOKENS_SIZE: u64 = 399_355;
const TARBALL_MODEL_DIR: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const TARBALL_MODEL_FILE: &str = "model.int8.onnx";

struct ModelCandidate {
    dir: &'static str,
    model_file: &'static str,
    model_size: u64,
    tokens_size: u64,
    model_urls: &'static [&'static str],
    tokens_urls: &'static [&'static str],
}

const PRIMARY_MODEL_URLS: &[&str] = &[
    "https://modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/model.int8.onnx",
    "https://hf-mirror.com/poloniumrock/SenseVoiceSmallOnnx/resolve/master/model.int8.onnx",
    "https://huggingface.co/poloniumrock/SenseVoiceSmallOnnx/resolve/master/model.int8.onnx",
];
const PRIMARY_TOKENS_URLS: &[&str] = &[
    "https://modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/tokens.txt",
    "https://hf-mirror.com/poloniumrock/SenseVoiceSmallOnnx/resolve/master/tokens.txt",
    "https://huggingface.co/poloniumrock/SenseVoiceSmallOnnx/resolve/master/tokens.txt",
];
const MANYEYES_MODEL_URLS: &[&str] =
    &["https://modelscope.cn/models/manyeyes/sensevoice-small-onnx/resolve/master/model.onnx"];
const MANYEYES_TOKENS_URLS: &[&str] =
    &["https://modelscope.cn/models/manyeyes/sensevoice-small-onnx/resolve/master/tokens.txt"];

const MODEL_CANDIDATES: &[ModelCandidate] = &[
    ModelCandidate {
        dir: PRIMARY_MODEL_DIR,
        model_file: PRIMARY_MODEL_FILE,
        model_size: PRIMARY_MODEL_SIZE,
        tokens_size: PRIMARY_TOKENS_SIZE,
        model_urls: PRIMARY_MODEL_URLS,
        tokens_urls: PRIMARY_TOKENS_URLS,
    },
    ModelCandidate {
        dir: MANYEYES_MODEL_DIR,
        model_file: MANYEYES_MODEL_FILE,
        model_size: MANYEYES_MODEL_SIZE,
        tokens_size: MANYEYES_TOKENS_SIZE,
        model_urls: MANYEYES_MODEL_URLS,
        tokens_urls: MANYEYES_TOKENS_URLS,
    },
];

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    step: String,
    progress: f32,
}

fn path_from_slash(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn temp_download_path(dest: &Path) -> PathBuf {
    let file_name = dest
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    dest.with_file_name(format!("{}.download", file_name))
}

async fn download_file(
    urls: &[&str],
    dest: &Path,
    app_handle: &AppHandle,
    step_name: &str,
    expected_size_hint: Option<u64>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let tmp_dest = temp_download_path(dest);
    let _ = fs::remove_file(&tmp_dest);
    let mut last_err = String::new();

    for attempt in 1..=12 {
        for url in urls {
            println!("Attempting download from: {} (Try {})", url, attempt);

            let response = match client.get(*url).send().await {
                Ok(response) => response,
                Err(e) => {
                    last_err = e.to_string();
                    println!("Request failed for {}: {}", url, last_err);
                    continue;
                }
            };

            if !response.status().is_success() {
                last_err = format!("HTTP error: {}", response.status());
                println!("Failed: {}", last_err);
                continue;
            }

            let expected_size = response
                .content_length()
                .or(expected_size_hint)
                .unwrap_or(0);
            let mut file = File::create(&tmp_dest).map_err(|e| e.to_string())?;
            let mut downloaded: u64 = 0;
            let mut stream = response.bytes_stream();
            let mut stream_success = true;

            use futures_util::StreamExt;
            while let Some(item) = stream.next().await {
                match item {
                    Ok(chunk) => {
                        downloaded += chunk.len() as u64;
                        if let Err(e) = file.write_all(&chunk) {
                            last_err = e.to_string();
                            stream_success = false;
                            break;
                        }

                        if expected_size > 0 {
                            let _ = app_handle.emit(
                                "download-progress",
                                DownloadProgress {
                                    step: step_name.to_string(),
                                    progress: downloaded as f32 / expected_size as f32,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        last_err = e.to_string();
                        stream_success = false;
                        break;
                    }
                }
            }

            if stream_success && expected_size > 0 && downloaded != expected_size {
                last_err = format!(
                    "incomplete download: {} of {} bytes",
                    downloaded, expected_size
                );
                stream_success = false;
            }

            if stream_success {
                file.flush().map_err(|e| e.to_string())?;
                drop(file);
                fs::rename(&tmp_dest, dest).map_err(|e| e.to_string())?;
                println!("Download successful from: {}", url);
                return Ok(());
            }

            println!("Stream failed during download from {}: {}", url, last_err);
            let _ = fs::remove_file(&tmp_dest);
        }
    }

    Err(format!(
        "All mirror sites failed to download. Last error: {}",
        last_err
    ))
}

fn unpack_tar_bz2_atomic(
    archive_path: &Path,
    base_dir: &Path,
    target_name: &str,
    ready_file: &str,
) -> Result<(), String> {
    let target_dir = base_dir.join(target_name);
    let staging_dir = base_dir.join(format!("{}.unpack", target_name));
    let unpacked_dir = staging_dir.join(target_name);
    let ready_path = unpacked_dir.join(path_from_slash(ready_file));

    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    let tar_bz2_file = File::open(archive_path).map_err(|e| e.to_string())?;
    let tar = BzDecoder::new(tar_bz2_file);
    let mut archive = Archive::new(tar);
    archive.unpack(&staging_dir).map_err(|e| e.to_string())?;

    if !ready_path.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(format!(
            "archive did not contain required file: {}",
            ready_file
        ));
    }

    let _ = fs::remove_dir_all(&target_dir);
    fs::rename(&unpacked_dir, &target_dir).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging_dir);
    Ok(())
}

fn find_ready_model(base_dir: &Path) -> Option<(PathBuf, &'static str)> {
    for candidate in MODEL_CANDIDATES {
        let model_dir = base_dir.join(candidate.dir);
        if model_dir.join(candidate.model_file).exists() && model_dir.join("tokens.txt").exists() {
            return Some((model_dir, candidate.model_file));
        }
    }

    let tarball_model_dir = base_dir.join(TARBALL_MODEL_DIR);
    if tarball_model_dir.join(TARBALL_MODEL_FILE).exists()
        && tarball_model_dir.join("tokens.txt").exists()
    {
        return Some((tarball_model_dir, TARBALL_MODEL_FILE));
    }

    None
}

async fn download_model_candidate_atomic(
    base_dir: &Path,
    app_handle: &AppHandle,
    candidate: &ModelCandidate,
) -> Result<(), String> {
    let target_dir = base_dir.join(candidate.dir);
    let staging_dir = base_dir.join(format!("{}.unpack", candidate.dir));
    let model_path = staging_dir.join(candidate.model_file);
    let tokens_path = staging_dir.join("tokens.txt");

    let _ = fs::remove_dir_all(&staging_dir);
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    let result = async {
        download_file(
            candidate.model_urls,
            &model_path,
            app_handle,
            "Downloading Model from ModelScope",
            Some(candidate.model_size),
        )
        .await?;
        download_file(
            candidate.tokens_urls,
            &tokens_path,
            app_handle,
            "Downloading Model Tokens from ModelScope",
            Some(candidate.tokens_size),
        )
        .await?;

        let model_size = model_path.metadata().map_err(|e| e.to_string())?.len();
        if model_size != candidate.model_size {
            return Err(format!(
                "invalid model size: {} bytes, expected {}",
                model_size, candidate.model_size
            ));
        }

        let tokens_size = tokens_path.metadata().map_err(|e| e.to_string())?.len();
        if tokens_size != candidate.tokens_size {
            return Err(format!(
                "invalid tokens size: {} bytes, expected {}",
                tokens_size, candidate.tokens_size
            ));
        }

        Ok::<(), String>(())
    }
    .await;

    if let Err(e) = result {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(e);
    }

    let _ = fs::remove_dir_all(&target_dir);
    fs::rename(&staging_dir, &target_dir).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn check_sensevoice_ready(app_handle: AppHandle) -> Result<bool, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let sherpa_dir = app_data_dir.join("sherpa-onnx");

    let exe_path = sherpa_dir
        .join(ENGINE_DIR)
        .join(path_from_slash(ENGINE_READY_FILE));
    Ok(exe_path.exists() && find_ready_model(&sherpa_dir).is_some())
}

#[tauri::command]
pub async fn download_sensevoice(app_handle: AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let sherpa_dir = app_data_dir.join("sherpa-onnx");

    if !sherpa_dir.exists() {
        fs::create_dir_all(&sherpa_dir).map_err(|e| e.to_string())?;
    }

    let exe_tar_path = sherpa_dir.join("sherpa-onnx-engine.tar.bz2");
    let model_tar_path = sherpa_dir.join("sense-voice-int8.tar.bz2");

    let exe_urls = [
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-libs/resolve/main/win64/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
        "https://huggingface.co/csukuangfj/sherpa-onnx-libs/resolve/main/win64/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
        "https://mirror.ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.10.33/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
        "https://ghproxy.net/https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.10.33/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
        "https://github.moeyy.xyz/https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.10.33/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.10.33/sherpa-onnx-v1.10.33-win-x64-static.tar.bz2",
    ];
    let model_urls = [
        "https://mirror.ghproxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "https://ghproxy.net/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "https://github.moeyy.xyz/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
    ];

    if !sherpa_dir
        .join(ENGINE_DIR)
        .join(path_from_slash(ENGINE_READY_FILE))
        .exists()
    {
        download_file(
            &exe_urls,
            &exe_tar_path,
            &app_handle,
            "Downloading Engine",
            None,
        )
        .await?;

        let _ = app_handle.emit(
            "download-progress",
            DownloadProgress {
                step: "Extracting Engine (this may take a minute...)".to_string(),
                progress: 1.0,
            },
        );

        let sherpa_dir_clone = sherpa_dir.clone();
        let exe_tar_path_clone = exe_tar_path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            unpack_tar_bz2_atomic(
                &exe_tar_path_clone,
                &sherpa_dir_clone,
                ENGINE_DIR,
                ENGINE_READY_FILE,
            )
        })
        .await
        .map_err(|e| e.to_string())??;

        let _ = fs::remove_file(&exe_tar_path);
    }

    if find_ready_model(&sherpa_dir).is_none() {
        let mut domestic_model_error = String::new();
        for candidate in MODEL_CANDIDATES {
            match download_model_candidate_atomic(&sherpa_dir, &app_handle, candidate).await {
                Ok(()) => {
                    domestic_model_error.clear();
                    break;
                }
                Err(e) => {
                    domestic_model_error = format!("{} failed: {}", candidate.dir, e);
                    println!(
                        "Domestic SenseVoice Small model download failed: {}",
                        domestic_model_error
                    );
                }
            }
        }

        if find_ready_model(&sherpa_dir).is_none() {
            println!(
                "Domestic model downloads failed, falling back to tarball: {}",
                domestic_model_error
            );

            download_file(
                &model_urls,
                &model_tar_path,
                &app_handle,
                "Downloading Model",
                None,
            )
            .await?;

            let _ = app_handle.emit(
                "download-progress",
                DownloadProgress {
                    step: "Extracting Model (this may take a minute...)".to_string(),
                    progress: 1.0,
                },
            );

            let sherpa_dir_clone = sherpa_dir.clone();
            let model_tar_path_clone = model_tar_path.clone();
            tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                unpack_tar_bz2_atomic(
                    &model_tar_path_clone,
                    &sherpa_dir_clone,
                    TARBALL_MODEL_DIR,
                    TARBALL_MODEL_FILE,
                )
            })
            .await
            .map_err(|e| e.to_string())??;

            let _ = fs::remove_file(&model_tar_path);
        }
    }

    let _ = app_handle.emit(
        "download-progress",
        DownloadProgress {
            step: "Done".to_string(),
            progress: 1.0,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn transcribe_sensevoice(
    app_handle: AppHandle,
    audio_path: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let sherpa_dir = app_data_dir.join("sherpa-onnx");

    let exe_path = sherpa_dir
        .join(ENGINE_DIR)
        .join(path_from_slash(ENGINE_READY_FILE));
    let (model_dir, model_file) = find_ready_model(&sherpa_dir)
        .ok_or_else(|| "SenseVoice Small model is not downloaded".to_string())?;

    let model_path = model_dir.join(model_file);
    let tokens_path = model_dir.join("tokens.txt");

    let output = std::process::Command::new(exe_path)
        .arg(format!("--sense-voice-model={}", model_path.display()))
        .arg(format!("--tokens={}", tokens_path.display()))
        .arg(&audio_path)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(stdout.into_owned())
}
