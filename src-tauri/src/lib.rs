use llama_cpp_4::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    num::NonZeroU32,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{ipc::Channel, Manager};
use tokio::io::AsyncWriteExt;

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
fn backend() -> &'static LlamaBackend {
    BACKEND.get_or_init(|| LlamaBackend::init().expect("llama backend init"))
}

struct AppState {
    llm: Mutex<Option<Arc<LlamaModel>>>,
    // NOTE: whisper context NOT cached — WhisperContext is !Send in some
    // whisper-rs versions, so creating per-request avoids Tauri State Send issues.
    // ggml-tiny load is ~100ms, acceptable.
}

// ---------- models: local path + HF download ----------
fn model_dir(app: &tauri::AppHandle) -> PathBuf {
    // CPU-only, persisted per user. No leading "/" — join("/models") would discard base.
    app.path().app_local_data_dir().unwrap().join("models")
}

fn whisper_path(app: &tauri::AppHandle) -> PathBuf {
    // dev fallback so `cargo run` still works before 1st download
    let prod = model_dir(app).join("whisper/ggml-tiny.bin");
    if prod.exists() {
        prod
    } else {
        PathBuf::from("models/whisper/ggml-tiny.bin")
    }
}

fn llm_path(app: &tauri::AppHandle) -> PathBuf {
    // fixed: was join("/transform/...") + "IQ§_XXS" typo
    let prod = model_dir(app).join("transform/s1-mini-IQ3_XXS.gguf");
    if prod.exists() {
        prod
    } else {
        PathBuf::from("models/transform/s1-mini-IQ3_XXS.gguf")
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModelStatus {
    whisper: bool,
    llm: bool,
}

#[tauri::command]
fn check_models(app: tauri::AppHandle) -> ModelStatus {
    ModelStatus {
        whisper: whisper_path(&app).exists(),
        llm: llm_path(&app).exists(),
    }
}

// Download with progress via Channel<u64> (bytes downloaded)
#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    which: String,
    channel: Channel<u64>,
) -> Result<String, String> {
    let url = match which.as_str() {
        "whisper" => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        "llm" => "https://huggingface.co/PrathamGhaywat/s1-mini-IQ3-variants-GGUF/resolve/main/s1-mini-IQ3_XXS.gguf",
        _ => return Err("unknown model".into()),
    };
    let dest = match which.as_str() {
        "whisper" => model_dir(&app).join("whisper/ggml-tiny.bin"),
        "llm" => model_dir(&app).join("transform/s1-mini-IQ3_XXS.gguf"),
        _ => unreachable!(),
    };
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()).into());
    }
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        let _ = channel.send(downloaded);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into())
}

// whisper
#[tauri::command]
async fn transcribe_pcm(app: tauri::AppHandle, samples: Vec<f32>) -> Result<String, String> {
    // samples MUST be 16kHz mono f32 from frontend (OfflineAudioContext)
    let path = whisper_path(&app);
    if !path.exists() {
        return Err("Whisper model missing. Download first.".into());
    }
    // AppHandle is 'static + Send, unlike State<'_, _>, so it can move into spawn_blocking
    tokio::task::spawn_blocking(move || {
        let ctx = whisper_rs::WhisperContext::new_with_params(
            path.to_string_lossy().as_ref(),
            whisper_rs::WhisperContextParameters::default(),
        )
        .map_err(|e| e.to_string())?;
        let mut wstate = ctx.create_state().map_err(|e| e.to_string())?;
        let mut params =
            whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
        params.set_translate(false);
        params.set_language(None::<&str>); // auto-detect
        params.set_print_special(false);
        wstate.full(params, &samples).map_err(|e| e.to_string())?;
        let n = wstate.full_n_segments().map_err(|e| e.to_string())?;
        let mut out = String::new();
        for i in 0..n {
            out.push_str(&wstate.full_get_segment_text(i).map_err(|e| e.to_string())?);
            out.push(' ');
        }
        Ok(out.trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// llama.cpp
#[tauri::command]
async fn ensure_llm_loaded(app: tauri::AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        if state.llm.lock().unwrap().is_some() {
            return Ok(());
        }
    }
    let path = llm_path(&app);
    if !path.exists() {
        return Err("LLM model missing. Download first.".into());
    }
    let b = backend();
    // load is heavy — run off the async runtime
    let path_clone = path.clone();
    let model = tokio::task::spawn_blocking(move || {
        LlamaModel::load_from_file(b, &path_clone, &LlamaModelParams::default())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let state = app.state::<AppState>();
    *state.llm.lock().unwrap() = Some(Arc::new(model));
    Ok(())
}

const SYSTEM_PROMPT: &str = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.";

#[tauri::command]
async fn transform(
    app: tauri::AppHandle,
    transcript: String, // raw from whisper
    styling: String,    // "casual" | "semi-casual" | "semi-formal" | "formal"
    structure: String,  // "prose" | "lists"
    context: String,    // "general" | "email"
    channel: Channel<String>,
) -> Result<(), String> {
    ensure_llm_loaded(app.clone()).await?;
    let model = app
        .state::<AppState>()
        .llm.lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or("LLM not loaded")?;

    // 1. Control line exactly as specified
    let control_line = format!(
        "[Styling: {}] [Structure: {}] [Context: {}]",
        styling, structure, context
    );
    let user_content = format!("{}\n{}", control_line, transcript);

    // 2. Chat via model's own template (handles <|im_start|> etc. for s1-mini)
    let msgs = vec![
        LlamaChatMessage::new("system".into(), SYSTEM_PROMPT.into())
            .map_err(|e| e.to_string())?,
        LlamaChatMessage::new("user".into(), user_content).map_err(|e| e.to_string())?,
    ];
    let prompt = model
        .apply_chat_template(None, &msgs, true)
        .map_err(|e| e.to_string())?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut ctx = model.new_context(
            backend(),
            LlamaContextParams::default().with_n_ctx(NonZeroU32::new(2048)),
        )
        .map_err(|e| e.to_string())?;

        let tokens = model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| e.to_string())?;
        let mut batch = LlamaBatch::new(2048, 1);
        for (i, &tok) in tokens.iter().enumerate() {
            batch
                .add(tok, i as i32, &[0], i == tokens.len() - 1)
                .map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;

        let mut sampler =
            LlamaSampler::chain_simple([LlamaSampler::temp(0.7), LlamaSampler::dist(0)]);
        let mut detok = StreamDetokenizer::new(model.clone());
        let mut cur = LlamaBatch::new(512, 1);
        let mut pos = tokens.len() as i32;

        for _ in 0..512 {
            // max new tokens
            let tok = sampler.sample(&ctx, 0);
            if model.is_eog_token(tok) {
                break;
            }
            if let Some(piece) = detok.detokenize(tok).map_err(|e| e.to_string())? {
                let _ = channel.send(piece); // stream
            }
            cur.clear();
            cur.add(tok, pos, &[0], true)
                .map_err(|e| e.to_string())?;
            ctx.decode(&mut cur).map_err(|e| e.to_string())?;
            pos += 1;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            llm: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_models,
            download_model,
            transcribe_pcm,
            ensure_llm_loaded,
            transform
        ])
        .run(tauri::generate_context!())
        .expect("tauri run");
}