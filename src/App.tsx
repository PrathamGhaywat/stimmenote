import { useEffect, useRef, useState } from "react"
import { invoke, Channel } from "@tauri-apps/api/core"
import { Check, ChevronDown, Copy, Download, Mic } from "lucide-react"
import "./App.css"

type AudioInput = { deviceId: string; label: string }
type ModelStatus = { whisper: boolean; whisper_cli: boolean }

export default function App() {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [copied, setCopied] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [models, setModels] = useState<ModelStatus | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([])
  const [selectedInputId, setSelectedInputId] = useState("")

  const mediaRef = useRef<{ stream: MediaStream; recorder: MediaRecorder; chunks: Blob[] } | null>(null)

  useEffect(() => {
    invoke<ModelStatus>("check_models")
      .then(setModels)
      .catch(() => setModels({ whisper: false, whisper_cli: false }))
  }, [])

  const refreshAudioInputs = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const inputs = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${index + 1}` }))
    setAudioInputs(inputs)
    if (selectedInputId && !inputs.some((input) => input.deviceId === selectedInputId)) setSelectedInputId("")
  }

  useEffect(() => {
    void refreshAudioInputs()
    const handleDeviceChange = () => void refreshAudioInputs()
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange)
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange)
  }, [selectedInputId])

  const downloadRuntime = async (which: "whisper" | "whisper-cli") => {
    const channel = new Channel<number>()
    channel.onmessage = (bytes) => setDownloadProgress((progress) => ({ ...progress, [which]: bytes }))
    try {
      await invoke("download_model", { which, channel })
      setModels(await invoke<ModelStatus>("check_models"))
    } catch (error) {
      console.error(error)
      alert(`Download failed: ${error}`)
    } finally {
      setDownloadProgress((progress) => ({ ...progress, [which]: 0 }))
    }
  }

  const startRecording = async () => {
    if (models && (!models.whisper || !models.whisper_cli)) {
      alert("Speech recognition is not ready. Download the Whisper files below.")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedInputId ? { deviceId: { exact: selectedInputId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      console.error(error)
      alert(`Microphone access failed: ${error}`)
      return
    }
    const activeInputId = stream.getAudioTracks()[0]?.getSettings().deviceId
    await refreshAudioInputs()
    if (activeInputId) setSelectedInputId(activeInputId)

    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      .find((type) => window.MediaRecorder?.isTypeSupported(type))
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
    recorder.onstop = async () => {
      setIsTranscribing(true)
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        const audioContext = new AudioContext()
        const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer())
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
        const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate)
        const firstChannel = decoded.getChannelData(0)
        if (decoded.numberOfChannels > 1) {
          const secondChannel = decoded.getChannelData(1)
          const mixed = mono.getChannelData(0)
          for (let index = 0; index < decoded.length; index++) mixed[index] = (firstChannel[index] + secondChannel[index]) * 0.5
        } else {
          mono.copyToChannel(firstChannel, 0)
        }
        const source = offline.createBufferSource()
        source.buffer = mono
        source.connect(offline.destination)
        source.start(0)
        const rendered = await offline.startRendering()
        const samples = Array.from(rendered.getChannelData(0))
        await audioContext.close()
        if (samples.length >= 1600) setTranscript(await invoke("transcribe_pcm", { samples }))
      } catch (error) {
        console.error(error)
        alert(`Transcription failed: ${error}`)
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
    mediaRef.current?.stream.getTracks().forEach((track) => track.stop())
    setRecording(false)
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
          <button className={`mic-button ${recording ? "recording" : ""}`} onClick={() => recording ? stopRecording() : void startRecording()} disabled={isTranscribing} aria-label={recording ? "Stop recording" : "Start recording"}>
            <Mic size={30} strokeWidth={1.8} />
          </button>
          <div className="record-title">{isTranscribing ? "Transcribing…" : recording ? "Listening…" : "Speak"}</div>
          <div className="record-subtitle">{recording ? "Click the microphone to stop" : isTranscribing ? "Running whisper tiny (16kHz)" : "Click to start dictating"}</div>
          <div className="input-picker">
            <Select label="Input" value={selectedInputId} onChange={setSelectedInputId} options={[["", "System default"], ...audioInputs.map((input) => [input.deviceId, input.label] as [string, string])]} />
          </div>
          {models && (!models.whisper || !models.whisper_cli) && (
            <div className="download-actions">
              {!models.whisper && <button onClick={() => downloadRuntime("whisper")} className="copy-button"><Download size={14} /> Download Whisper model {downloadProgress.whisper ? `(${(downloadProgress.whisper / 1e6).toFixed(1)} MB)` : ""}</button>}
              {!models.whisper_cli && <button onClick={() => downloadRuntime("whisper-cli")} className="copy-button"><Download size={14} /> Download Whisper runtime</button>}
            </div>
          )}
        </div>
        <section className="editor">
          <div className="section-label">Transcript</div>
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Your words will appear here..." spellCheck />
        </section>
        <footer className="actions">
          <button className="copy-button" onClick={copyText} disabled={!transcript}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}</button>
        </footer>
      </section>
    </main>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="select-wrapper"><span>{label}</span><div className="select"><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select><ChevronDown size={14} /></div></label>
}