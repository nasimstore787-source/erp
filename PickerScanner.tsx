import { useEffect, useId, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

export function PickerScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const id = useId();
  const [feedback, setFeedback] = useState('وجّه الكاميرا إلى الباركود.');
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => {
    const element = dialog.current;
    const camera = video.current;
    element?.showModal();
    let active = true;
    let timer = 0;
    let stream: MediaStream | undefined;
    async function start() {
      const BarcodeDetector = (window as Window & { BarcodeDetector?: new () => Detector }).BarcodeDetector;
      if (!BarcodeDetector || !navigator.mediaDevices?.getUserMedia || !camera) {
        setFeedback('المسح بالكاميرا غير متاح هنا. استخدم إدخال الباركود أو قارئ بلوتوث.');
        return;
      }
      try {
        const detector = new BarcodeDetector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        camera.srcObject = stream;
        await camera.play();
        async function detect() {
          if (!active || !camera) return;
          try {
            const [hit] = await detector.detect(camera);
            if (!active) return;
            if (hit?.rawValue) { onScanRef.current(hit.rawValue); return; }
          } catch { /* The next camera frame may be readable. */ }
          if (active) timer = window.setTimeout(detect, 180);
        }
        void detect();
      } catch {
        if (active) setFeedback('تعذّر فتح الكاميرا. تحقّق من الإذن أو استخدم إدخال الباركود.');
      }
    }
    void start();
    return () => { active = false; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); element?.close(); };
  }, []);

  return <dialog ref={dialog} className="e-dialog e-picker-camera" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={id}><Camera size={19} aria-hidden="true" /> مسح بالكاميرا</h2><button className="e-icon-button" type="button" onClick={onClose} aria-label="إغلاق الكاميرا" autoFocus><X size={20} aria-hidden="true" /></button></header>
    <video ref={video} muted playsInline aria-hidden="true" />
    <p role="status">{feedback}</p>
    <button type="button" className="e-button secondary" onClick={onClose}>استخدم إدخال الباركود</button>
  </dialog>;
}
