/**
 * Shrink a camera photo before upload: fixes EXIF rotation, caps the long side and re-encodes
 * as JPEG. A 12 MP photo (~4 MB) becomes ~200–400 KB, plenty for food recognition.
 */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.85): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // format the browser can't decode (e.g. HEIC outside Safari); the server will say if it can't either
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ?? file;
}
