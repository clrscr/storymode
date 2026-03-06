import { embedBlueprintInPng } from './png.js';

export function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i += 1) {
    const testLine = `${line}${words[i]} `;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, y);
      line = `${words[i]} `;
      y += lineHeight;
      lines += 1;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, y);
  return lines + 1;
}

export function generateBlueprintPngDataUrl(blueprint) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1400;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '28px serif';
  ctx.fillText(blueprint.title || 'Scenario Blueprint', 40, 60);

  ctx.font = '18px serif';
  const lines = wrapText(ctx, blueprint.logline || '', 40, 110, 920, 24);
  let y = 110 + lines * 24 + 20;

  ctx.fillText(`Genre: ${blueprint.genre || ''}`, 40, y);
  y += 30;

  (blueprint.scenes || []).forEach(scene => {
    ctx.fillText(`Scene: ${scene.title || ''}`, 40, y);
    y += 26;
    (scene.beats || []).forEach(beat => {
      ctx.fillText(`- ${beat.label || ''}: ${beat.goal || ''}`, 60, y);
      y += 22;
    });
    y += 12;
  });
  return canvas.toDataURL('image/png');
}

export function exportBlueprintPng(blueprint) {
  const dataUrl = generateBlueprintPngDataUrl(blueprint);
  const embedded = embedBlueprintInPng(dataUrl, blueprint);
  const link = document.createElement('a');
  link.download = `${(blueprint.title || 'blueprint').replace(/\s+/g, '_')}.png`;
  link.href = embedded;
  link.click();
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file) {
  const { toastr } = SillyTavern.getContext();
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return parsed.items ? parsed.items : parsed;
  } catch (err) {
    console.warn('[Store Mode] Failed to parse JSON import', err);
    toastr && toastr.warning('Store Mode: invalid JSON file.');
    return null;
  }
}
