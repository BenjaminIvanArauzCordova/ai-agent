import { useRef, useState } from "react";
import { REQUIRED_COLUMNS } from "../types";

interface Props {
  onFile: (file: File) => void;
  compact?: boolean;
}

export function DropZone({ onFile, compact = false }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  const open = () => inputRef.current?.click();

  return (
    <div
      className={`dropzone${compact ? " compact" : ""}`}
      data-dragging={dragging}
      role="group"
      aria-label="CSV file upload area"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {compact ? (
        <button type="button" className="dropzone-button" onClick={open}>
          Load another CSV
        </button>
      ) : (
        <>
          <p className="dropzone-title">Drop a CSV from the outputs folder</p>
          <p className="dropzone-hint">Choose a file from your device, or drag it here.</p>
          <button type="button" className="dropzone-button" onClick={open}>
            Choose CSV file
          </button>
          <p className="dropzone-columns">
            Expected columns: {REQUIRED_COLUMNS.join(", ")}
          </p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
