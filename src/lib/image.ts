/** ضغط صورة البطاقة قبل الرفع (عشان ما تاخدش مساحة) */
export async function compressImage(
  file: File,
  maxDim = 1600,
  quality = 0.82
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("تعذر تجهيز الصورة على هذا الجهاز");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("فشل ضغط الصورة"))),
      "image/jpeg",
      quality
    );
  });
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + " بايت";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " كيلوبايت";
  return (bytes / 1024 / 1024).toFixed(1) + " ميجابايت";
}
