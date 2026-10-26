let saver = false;
/** Data saver: photos are made smaller (about half the data) before they are sent. */
export const setDataSaver = (on: boolean) => { saver = on; };

/** Downscale a photo before sending it to the AI or reading it on the phone (saves data on slow networks). */
export async function toDataUrl(file: File, max = 1280): Promise<string> {
  if (saver) max = Math.min(max, 1024);
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', saver ? 0.7 : 0.8);
}
