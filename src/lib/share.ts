// Share or save a generated file (PDF, Excel). Android app: native share sheet via Capacitor.
// Browser: Web Share API with files (WhatsApp, Drive, email…), falling back to a download.
import { Capacitor } from '@capacitor/core';

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareFile(blob: Blob, filename: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const res = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title, files: [res.uri] });
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  downloadBlob(blob, filename);
}
