import { dataUrlToUint8Array, uint8ArrayToDataUrl } from './utils.js';

export function crc32(bytes) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i += 1) {
    let c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ (-1)) >>> 0;
}

export function encodeTextChunk(keyword, text) {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);

  const type = new TextEncoder().encode('tEXt');
  const length = data.length;
  const chunk = new Uint8Array(12 + length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crc = crc32(new Uint8Array([...type, ...data]));
  view.setUint32(8 + length, crc);
  return chunk;
}

export function insertTextChunk(pngBytes, keyword, text) {
  const signature = pngBytes.slice(0, 8);
  const chunks = [];
  let offset = 8;
  while (offset < pngBytes.length) {
    const length = new DataView(pngBytes.buffer, offset, 4).getUint32(0);
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7]
    );
    const chunkEnd = offset + 12 + length;
    const chunk = pngBytes.slice(offset, chunkEnd);
    if (type === 'IEND') {
      const textChunk = encodeTextChunk(keyword, text);
      chunks.push(textChunk);
    }
    chunks.push(chunk);
    offset = chunkEnd;
  }
  const totalLength = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const output = new Uint8Array(totalLength);
  output.set(signature, 0);
  let outOffset = 8;
  chunks.forEach((chunk) => {
    output.set(chunk, outOffset);
    outOffset += chunk.length;
  });
  return output;
}

export function extractTextChunks(pngBytes) {
  const chunks = {};
  let offset = 8;
  while (offset < pngBytes.length) {
    const length = new DataView(pngBytes.buffer, offset, 4).getUint32(0);
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7]
    );
    if (type === 'tEXt') {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const data = pngBytes.slice(dataStart, dataEnd);
      const nulIndex = data.indexOf(0);
      if (nulIndex > -1) {
        const key = new TextDecoder().decode(data.slice(0, nulIndex));
        const value = new TextDecoder().decode(data.slice(nulIndex + 1));
        chunks[key] = value;
      }
    }
    offset += 12 + length;
  }
  return chunks;
}

export function embedBlueprintInPng(dataUrl, blueprint) {
  const json = JSON.stringify(blueprint);
  const bytes = dataUrlToUint8Array(dataUrl);
  const injected = insertTextChunk(bytes, 'STOREMODE_JSON', json);
  return uint8ArrayToDataUrl(injected);
}

export async function extractBlueprintFromPng(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const chunks = extractTextChunks(bytes);
  if (!chunks.STOREMODE_JSON) return null;
  return JSON.parse(chunks.STOREMODE_JSON);
}
