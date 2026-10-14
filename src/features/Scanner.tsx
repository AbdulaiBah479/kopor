// Camera barcode / QR scanner. Uses the browser's built-in BarcodeDetector when available (fast, no
// download) and the ZXing library otherwise. Loaded on demand.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const NativeDetector = (window as unknown as { BarcodeDetector?: new (o?: unknown) => Detector }).BarcodeDetector;

export default function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let controls: IScannerControls | null = null;
    let stream: MediaStream | null = null;
    const done = (code: string) => { if (stopped) return; stopped = true; navigator.vibrate?.(60); onCode(code.trim()); };

    (async () => {
      try {
        if (NativeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.current!.srcObject = stream;
          await video.current!.play();
          const detector = new NativeDetector();
          const tick = async () => {
            if (stopped || !video.current) return;
            const found = await detector.detect(video.current).catch(() => []);
            if (found[0]?.rawValue) done(found[0].rawValue); else requestAnimationFrame(tick);
          };
          tick();
        } else {
          controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current!, (result) => { if (result) done(result.getText()); });
        }
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? t('scan.denied') : t('scan.noCamera'));
      }
    })();
    return () => { stopped = true; controls?.stop(); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [onCode, t]);

  return (
    <div className="stack">
      {error ? <div className="alert bad">{error}</div> : <div className="small muted">{t('scan.help')}</div>}
      <video ref={video} className="scan-preview" muted playsInline style={{ background: '#000', aspectRatio: '4 / 3' }} />
    </div>
  );
}
