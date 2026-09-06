import { useEffect, useRef, useState } from "react"
import { invoke, Channel } from "@tauri-apps/api/core"
import { Mic, Copy, Sparkles, ChevronDown, Check, Download } from "lucide-react"
import "./App.css"

type Styling = "casual" | "semi-casual" | "semi-formal" | "formal"
type Structure = "prose" | "lists"
type Context = "general" | "email"

type ModelStatus = { whisper: boolean; llm: boolean }

export default function App() {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [styling, setStyling] = useState<Styling>("semi-casual")
  const [structure, setStructure] = useState<Structure>("prose")
  const [context, setContext] = useState<Context>("general")
  const [copied, setCopied] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [models, setModels] = useState<ModelStatus | null>(null)
  const [dlProgress, setDlProgress] = useState<Record<string, number>>({})

  const mediaRef = useRef<{
    stream: MediaStream
    recorder: MediaRecorder
    chunks: Blob[]
  } | null>(null)

  // check models on mount — app downloads later to appLocalDataDir/models/*
  useEffect(() => {
    invoke<ModelStatus>("check_models")
      .then(setModels)
      .catch(() => setModels({ whisper: false, llm: false }))
  }, [])

  const downloadModel = async (which: "whisper" | "llm") => {
    const ch = new Channel<number>()
    ch.onmessage = (bytes) => setDlProgress((p) => ({ ...p, [which]: bytes }))
    try {
      await invoke("download_model", { which, channel: ch })
      const s = await invoke<ModelStatus>("check_models")
      setModels(s)
    } catch (e) {
      console.error(e)
      alert(`Failed to download ${which}: ${e}`)
    } finally {
      setDlProgress((p) => ({ ...p, [which]: 0 }))
    }
  }

  const startRecording = async () => {
    if (models && !models.whisper) {
      alert("Whisper model not downloaded yet. Click Download below.")
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webmcodecs=opus" })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = async () => {
      setIsTranscribing(true)
      try {
        const blob = new Blob(chunks, { type: "audio/webm" })
        const ab = await blob.arrayBuffer()
        const actx = new AudioContext()
        const decoded = await actx.decodeAudioData(ab.slice(0))
        // resample to 16kHz mono f32 — required by whisper-rs
        const duration = decoded.duration
        const targetLen = Math.ceil(duration * 16000)
        const offline = new OfflineAudioContext(1, targetLen, 16000)
        const src = offline.createBufferSource()
        // mix to mono (average if stereo)
        const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate)
        const ch0 = decoded.getChannelData(0)
        if (decoded.numberOfChannels > 1) {
          const ch1 = decoded.getChannelData(1)
          const mixed = mono.getChannelData(0)
          for (let i = 0; i < decoded.length; i++) mixed[i] = (ch0[i] + ch1[i]) * 0.5
        } else {
          mono.copyToChannel(ch0, 0)
        }
        src.buffer = mono
        src.connect(offline.destination)
        src.start(0)
        const rendered = await offline.startRendering()
        const samples = Array.from(rendered.getChannelData(0)) // f32 16kHz
        await actx.close()
        if (samples.length < 1600) {
          setIsTranscribing(false)
          return
        }
        const text: string = await invoke("transcribe_pcm", { samples })
        setTranscript(text)
      } catch (e) {
        console.error(e)
        alert(`Transcription failed: ${e}`)
      } finally {
        setIsTranscribing(false)
      }
    }
    mediaRef.current = { stream, recorder, chunks }
    recorder.start(100)
    setRecording(true)
  }

  const stopRecording = () => {
    mediaRef.current?.recorder.stop()
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop())
    setRecording(false)
  }

  const toggleRecording = () => (recording ? stopRecording() : startRecording())

  // System prompt is fixed in Rust (llama-cpp-4):
  // "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings clean the transcript to match those settings and output only the cleaned text."
  // User message = "[Styling: <v>] [Structure: <v>] [Context: <v>]\n<raw transcript>"
  const handleTransform = async () => {
    if (!transcript.trim() || isTransforming) return
    if (models && !models.llm) {
      alert("Transform model (s1-mini) not downloaded yet. Click Download below.")
      return
    }
    setIsTransforming(true)
    const original = transcript
    setTranscript("") // streaming replaces
    const ch = new Channel<string>()
    ch.onmessage = (piece) => setTranscript((prev) => prev + piece)
    try {
      await invoke("transform", { transcript: original, styling, structure, context, channel: ch })
      if (!transcript) setTranscript(original) // fallback if no tokens
    } catch (e) {
      console.error(e)
      setTranscript(original)
      alert(`Transform failed: ${e}`)
    } finally {
      setIsTransforming(false)
    }
  }

  const copyText = async () => {
    if (!transcript) return
    await navigator.clipboard.writeText(transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="app">
      <section className="workspace">
        <div className="record-area">
          <button
            className={`mic-button ${recording ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={isTranscribing || isTransforming}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            <Mic size={30} strokeWidth={1.8} />
          </button>
          <div className="record-title">
            {isTranscribing ? "Transcribing…" : isTransforming ? "Transforming…" : recording ? "Listening…" : "Speak"}
          </div>
          <div className="record-subtitle">
            {recording ? "Click the microphone to stop" : isTranscribing ? "Running whisper tiny (16kHz)" : "Click to start dictating"}
          </div>
          {models && (!models.whisper || !models.llm) && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              {!models.whisper && (
                <button onClick={() => downloadModel("whisper")} className="copy-button">
                  <Download size={14} /> Download whisper tiny {dlProgress.whisper ? `(${(dlProgress.whisper/1e6).toFixed(1)} MB)` : ""}
                </button>
              )}
              {!models.llm && (
                <button onClick={() => downloadModel("llm")} className="copy-button">
                  <Download size={14} /> Download s1-mini {dlProgress.llm ? `(${(dlProgress.llm/1e6).toFixed(1)} MB)` : ""}
                </button>
              )}
            </div>
          )}
        </div>

        <section className="editor">
          <div className="section-label">Transcript</div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your words will appear here..."
            spellCheck
          />
        </section>

        <section className="controls">
          <Select label="Styling" value={styling} onChange={(v) => setStyling(v as Styling)} options={[["casual","Casual"],["semi-casual","Semi-casual"],["semi-formal","Semi-formal"],["formal","Formal"]]} />
          <Select label="Structure" value={structure} onChange={(v) => setStructure(v as Structure)} options={[["prose","Prose"],["lists","Lists"]]} />
          <Select label="Context" value={context} onChange={(v) => setContext(v as Context)} options={[["general","General"],["email","Email"]]} />
        </section>

        <footer className="actions">
          <button className="transform-button" onClick={handleTransform} disabled={!transcript || isTransforming || isTranscribing}>
            <Sparkles size={16} /> {isTransforming ? "Transforming…" : "Transform"}
          </button>
          <button className="copy-button" onClick={copyText} disabled={!transcript}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
          </button>
        </footer>
      </section>
    </main>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="select-wrapper">
      <span>{label}</span>
      <div className="select">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <ChevronDown size={14} />
      </div>
    </label>
  )
}