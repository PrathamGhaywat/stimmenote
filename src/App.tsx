import { useState } from "react";
import {
  Mic,
  Copy,
  Sparkles,
  ChevronDown,
  Check,
} from "lucide-react";
import "./App.css";

type Styling = "casual" | "semi-casual" | "semi-formal" | "formal";
type Structure = "prose" | "lists";
type Context = "general" | "email";

function App() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [styling, setStyling] = useState<Styling>("semi-casual");
  const [structure, setStructure] = useState<Structure>("prose");
  const [context, setContext] = useState<Context>("general");
  const [copied, setCopied] = useState(false);

  const toggleRecording = () => {
    setRecording((value) => !value);
  };

  const copyText = async () => {
    if (!transcript) return;

    await navigator.clipboard.writeText(transcript);
    setCopied(true);

    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="app">
      <section className="workspace">
        <div className="record-area">
          <button
            className={`mic-button ${recording ? "recording" : ""}`}
            onClick={toggleRecording}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            <Mic size={30} strokeWidth={1.8} />
          </button>

          <div className="record-title">
            {recording ? "Listening…" : "Speak"}
          </div>

          <div className="record-subtitle">
            {recording
              ? "Click the microphone to stop"
              : "Click to start dictating"}
          </div>
        </div>

        <section className="editor">
          <div className="section-label">Transcript</div>

          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Your words will appear here..."
            spellCheck
          />
        </section>

        <section className="controls">
          <Select
            label="Styling"
            value={styling}
            onChange={(value) => setStyling(value as Styling)}
            options={[
              ["casual", "Casual"],
              ["semi-casual", "Semi-casual"],
              ["semi-formal", "Semi-formal"],
              ["formal", "Formal"],
            ]}
          />

          <Select
            label="Structure"
            value={structure}
            onChange={(value) => setStructure(value as Structure)}
            options={[
              ["prose", "Prose"],
              ["lists", "Lists"],
            ]}
          />

          <Select
            label="Context"
            value={context}
            onChange={(value) => setContext(value as Context)}
            options={[
              ["general", "General"],
              ["email", "Email"],
            ]}
          />
        </section>

        <footer className="actions">
          <button className="transform-button" disabled={!transcript}>
            <Sparkles size={16} />
            Transform
          </button>

          <button
            className="copy-button"
            onClick={copyText}
            disabled={!transcript}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </footer>
      </section>
    </main>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="select-wrapper">
      <span>{label}</span>

      <div className="select">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>

        <ChevronDown size={14} />
      </div>
    </label>
  );
}

export default App;