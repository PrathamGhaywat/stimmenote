use serde::{Deserialize, Serialize};
use std::{io::Cursor, path::PathBuf};
use tauri::{ipc::Channel, Manager};
use tokio::io::AsyncWriteExt;
use zip::ZipArchive;

fn model_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap().join("models")
}

fn whisper_path(app: &tauri::AppHandle) -> PathBuf {
    let installed = model_dir(app).join("whisper/ggml-tiny.bin");
    if installed.exists() {
        installed
    } else {
        PathBuf::from("models/whisper/ggml-tiny.bin")
    }
}

fn local_whisper_bin_dir(app: &tauri::AppHandle) -> PathBuf {
    model_dir(app).join("bin")
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModelStatus {
    whisper: bool,
    whisper_cli: bool,
}

#[tauri::command]
fn check_models(app: tauri::AppHandle) -> ModelStatus {
    ModelStatus {
        whisper: whisper_path(&app).exists(),
        whisper_cli: whisper_bin(&app).is_some(),
    }
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn whisper_archive_url() -> Result<&'static str, String> {
    Ok("https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip")
}

#[cfg(all(target_os = "windows", target_arch = "x86"))]
fn whisper_archive_url() -> Result<&'static str, String> {
    Ok("https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-Win32.zip")
}

#[cfg(not(any(
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86")
)))]
fn whisper_archive_url() -> Result<&'static str, String> {
    Err("Automatic Whisper runtime download is not available for this platform. Bundle whisper-cli in src-tauri/binaries instead.".into())
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    which: String,
    channel: Channel<u64>,
) -> Result<String, String> {
    if which == "whisper-cli" {
        let response = reqwest::get(whisper_archive_url()?)
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        let target = local_whisper_bin_dir(&app);
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let Some(name) = entry
                .enclosed_name()
                .and_then(|path| path.file_name().map(PathBuf::from))
            else {
                continue;
            };
            if !entry.is_file() {
                continue;
            }
            let mut output = std::fs::File::create(target.join(name)).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
        }
        return Ok(target.to_string_lossy().into());
    }
    if which != "whisper" {
        return Err("unknown download".into());
    }
    let destination = model_dir(&app).join("whisper/ggml-tiny.bin");
    std::fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
    let response =
        reqwest::get("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin")
            .await
            .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let mut file = tokio::fs::File::create(&destination)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded = 0;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        let _ = channel.send(downloaded);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(destination.to_string_lossy().into())
}

fn whisper_bin(app: &tauri::AppHandle) -> Option<PathBuf> {
    let suffix = std::env::consts::EXE_SUFFIX;
    let names = [format!("whisper-cli{suffix}"), format!("whisper{suffix}")];
    for name in &names {
        let local = local_whisper_bin_dir(app).join(name);
        if local.exists() {
            return Some(local);
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        for name in &names {
            let bundled = resources.join("binaries").join(name);
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    for name in &names {
        for directory in ["binaries", "src-tauri/binaries"] {
            let development = PathBuf::from(directory).join(name);
            if development.exists() {
                return Some(development);
            }
        }
    }
    None
}

#[tauri::command]
async fn transcribe_pcm(app: tauri::AppHandle, samples: Vec<f32>) -> Result<String, String> {
    let model = whisper_path(&app);
    if !model.exists() {
        return Err("Whisper model missing. Download it first.".into());
    }
    let binary = whisper_bin(&app).ok_or("Whisper CLI missing. Download the runtime first.")?;
    if samples.len() < 1600 {
        return Ok(String::new());
    }
    tokio::task::spawn_blocking(move || {
        let mut wav = std::env::temp_dir();
        wav.push(format!("stimmenote-{}.wav", std::process::id()));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut writer = hound::WavWriter::create(&wav, spec).map_err(|e| e.to_string())?;
        for sample in samples {
            writer.write_sample(sample).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
        let output_prefix = wav.with_extension("out");
        let output = std::process::Command::new(binary)
            .args([
                "-m",
                model.to_string_lossy().as_ref(),
                "-f",
                wav.to_string_lossy().as_ref(),
                "-otxt",
                "-of",
                output_prefix.to_string_lossy().as_ref(),
            ])
            .output()
            .map_err(|e| format!("failed to run whisper-cli: {e}"))?;
        let _ = std::fs::remove_file(&wav);
        if !output.status.success() {
            return Err(format!(
                "whisper-cli failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        let text_path = output_prefix.with_extension("txt");
        let text = std::fs::read_to_string(&text_path)
            .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).into_owned());
        let _ = std::fs::remove_file(text_path);
        Ok(text.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_models,
            download_model,
            transcribe_pcm
        ])
        .run(tauri::generate_context!())
        .expect("tauri run");
}
