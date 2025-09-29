import React, { useState, useRef, useEffect } from 'react';
import Webcam from 'react-webcam';
import { createWorker } from 'tesseract.js';

const BACKEND_SEARCH_ENDPOINT = '/api/search'; // with CRA proxy it maps to http://localhost:5000

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);      // data URL preview
  const [ocrText, setOcrText] = useState('');          // extracted text
  const [matches, setMatches] = useState([]);          // backend results
  const [warning, setWarning] = useState(null);
  const [loadingOcr, setLoadingOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isWorkerReady, setIsWorkerReady] = useState(false);

  const webcamRef = useRef(null);
  const workerRef = useRef(null);

  // Initialize Tesseract worker on mount
  useEffect(() => {
    const initWorker = async () => {
      const worker = createWorker({
        logger: m => {
          // progress logs: { status, progress }
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        }
      });
      workerRef.current = worker;
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      setIsWorkerReady(true);
      console.log('Tesseract worker ready');
    };

    initWorker();

    return () => {
      // cleanup on unmount
      (async () => {
        if (workerRef.current) {
          try {
            await workerRef.current.terminate();
          } catch (e) {
            // ignore
          }
        }
      })();
    };
  }, []);

  // Helper: perform OCR on a dataURL (image)
  const runOcr = async (dataUrl) => {
    if (!workerRef.current) {
      alert('OCR engine not ready yet. Please wait a moment.');
      return '';
    }

    setLoadingOcr(true);
    setOcrText('');
    setOcrProgress(0);
    try {
      // Tesseract accepts a data URL
      const { data } = await workerRef.current.recognize(dataUrl);
      const text = (data && data.text) ? data.text.trim() : '';
      setOcrText(text);
      setLoadingOcr(false);
      return text;
    } catch (err) {
      console.error('OCR error:', err);
      setLoadingOcr(false);
      return '';
    }
  };

  // Send OCR text to backend and get fuzzy matches
  const queryBackend = async (text) => {
    setMatches([]);
    setWarning(null);
    if (!text || !text.trim()) {
      setWarning('No text found by OCR.');
      return;
    }

    try {
      const res = await fetch(BACKEND_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Backend error:', err);
        setWarning('Server error when searching. Check backend.');
        return;
      }

      const data = await res.json();
      setMatches(data.matches || []);
      if (data.warning) setWarning(data.warning);
    } catch (err) {
      console.error('Network error:', err);
      setWarning('Network error when contacting backend.');
    }
  };

  // Handles local file upload
  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setImageSrc(dataUrl);
      const text = await runOcr(dataUrl);
      await queryBackend(text);
    };
    reader.readAsDataURL(file);
  };

  // Capture from webcam
  const handleCapture = async () => {
    const img = webcamRef.current.getScreenshot();
    if (!img) {
      alert('Could not capture image from camera.');
      return;
    }
    setImageSrc(img);
    const text = await runOcr(img);
    await queryBackend(text);
  };

  // Small UI helper to show confidence percentage from fuse score (score: lower = better)
  const scoreToPercent = (score) => {
    if (typeof score !== 'number') return '—';
    // fuse's score typically in [0,1]; convert to (1 - score) * 100
    const p = Math.max(0, Math.min(100, Math.round((1 - score) * 100)));
    return `${p}%`;
  };

  return (
    <div className="container">
      <header>
        <h1>Aushadhi-OCR</h1>
        <p className="subtitle">Upload or capture a medicine pack — OCR runs in your browser, fuzzy search runs on the backend.</p>
      </header>

      <main>
        <section className="card">
          <h2>1. Provide an image</h2>

          <div className="row">
            <div className="col">
              <label className="btn file-btn">
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
              <p className="hint">On mobile, 'Upload image' may open the camera when you choose 'Take photo'.</p>
            </div>

            <div className="col">
              <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                width={320}
                videoConstraints={{ facingMode: 'environment' }}
                className="webcam"
              />
              <button className="btn" onClick={handleCapture} disabled={!isWorkerReady}>Capture from camera</button>
              {!isWorkerReady && <p className="hint">Initializing OCR engine — please wait...</p>}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>2. Preview & OCR</h2>

          {imageSrc ? (
            <div className="preview">
              <img src={imageSrc} alt="preview" />
            </div>
          ) : (
            <div className="placeholder">No image selected</div>
          )}

          <div className="ocr-area">
            {loadingOcr ? (
              <div>
                <p>Running OCR... {ocrProgress}%</p>
                <progress value={ocrProgress} max="100" />
              </div>
            ) : (
              <div>
                <h3>Extracted text</h3>
                <pre className="ocr-text">{ocrText || '—'}</pre>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <h2>3. Matches (from trusted DB)</h2>

          {warning && <div className="warning">{warning}</div>}

          {matches.length === 0 ? (
            <p>No results yet. Upload/capture an image to start.</p>
          ) : (
            <ul className="matches">
              {matches.map((m, i) => (
                <li key={i} className={i === 0 ? 'best' : ''}>
                  <div className="match-name">{m.name}</div>
                  <div className="match-score">Confidence: {scoreToPercent(m.score)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer>
        <small>Tip: Good lighting and a close, flat photo of the label improve OCR accuracy.</small>
      </footer>
    </div>
  );
}
