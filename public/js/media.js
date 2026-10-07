// Foto dell'intranet: scelta, riduzione nel browser (lato lungo 1600 px, JPEG) e caricamento.
import { api } from './api.js';

export const mediaUrl = id => `/api/media/${id}`;

export function pickImages({ multiple = false } = {}) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

async function prepareImage(file, max) {
  let bmp;
  try {
    bmp = await createImageBitmap(file); // applica già l'orientamento EXIF delle foto del telefono
  } catch {
    throw new Error(`«${file.name}» non è un'immagine che il browser sa leggere (usa JPG, PNG, GIF o WebP)`);
  }
  // Le GIF restano animate se non sono enormi.
  if (file.type === 'image/gif' && file.size < 8 * 1024 * 1024) return { blob: file, width: bmp.width, height: bmp.height };
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNG trasparenti su bianco
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  return { blob, width, height };
}

// → { id, width, height }
export async function uploadImage(file, { max = 1600 } = {}) {
  const { blob, width, height } = await prepareImage(file, max);
  return api('POST', `/api/media?w=${width}&h=${height}`, blob, { raw: true, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
}
