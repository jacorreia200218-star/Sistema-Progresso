// Compressão de fotografias no browser antes do envio (reduz tamanho e remove metadados EXIF,
// incluindo localização, porque a imagem é redesenhada num canvas).
export async function compressImage(file: File, maxSide = 640, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Escolhe uma imagem (JPG, PNG ou WebP).');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Não foi possível ler a imagem.');
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Não foi possível comprimir a imagem.');
  return blob;
}

/**
 * Fotografia de perfil: corta ao centro num quadrado e reduz para `side` px.
 * Respeita a orientação EXIF (fotografias de telemóvel) e remove os metadados.
 */
export async function squarePhoto(file: File, side = 512, quality = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Escolhe uma imagem (JPG, PNG ou WebP).');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('Não foi possível ler a imagem.');
  });
  const crop = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - crop) / 2;
  const sy = (bitmap.height - crop) / 2;
  const out = Math.min(side, crop);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem.');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; // PNG com transparência não fica com fundo preto
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bitmap, sx, sy, crop, crop, 0, 0, out, out);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Não foi possível comprimir a imagem.');
  return blob;
}

export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ATTACHMENT_MAX = 10 * 1024 * 1024;

/** Prepara um anexo: imagens grandes são comprimidas; PDFs seguem como estão. */
export async function prepareAttachment(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  if (!ATTACHMENT_TYPES.includes(file.type)) throw new Error('Tipo de ficheiro não permitido. Usa JPG, PNG, WebP ou PDF.');
  if (file.type.startsWith('image/')) {
    const blob = file.size > 600 * 1024 ? await compressImage(file, 1800, 0.85) : file;
    const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, name, type: blob === file ? file.type : 'image/jpeg' };
  }
  if (file.size > ATTACHMENT_MAX) throw new Error('O ficheiro excede 10 MB.');
  return { blob: file, name: file.name, type: file.type };
}

export function safeFileName(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return base.slice(-80) || 'ficheiro';
}
