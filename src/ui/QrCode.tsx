import { useEffect, useState } from 'react';

/** A QR code for a link or payment text (the library loads only when a QR is shown). */
export function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    import('qrcode').then((q) => q.toDataURL(text, { margin: 1, width: 260, errorCorrectionLevel: 'M' })).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [text]);
  return src ? <img className="qr" src={src} alt="" width={260} height={260} /> : <div className="qr" />;
}
