export const FILE_PREFIX = 'storymode-';
export const MANIFEST_FILENAME = 'storymode-manifest.json';

export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function makeId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getRequestHeadersSafe() {
  if (typeof window.getRequestHeaders === 'function') {
    return window.getRequestHeaders();
  }
  return { 'Content-Type': 'application/json' };
}

export function getConnectionProfiles() {
  const { extensionSettings } = SillyTavern.getContext();
  return extensionSettings?.connectionManager?.profiles || [];
}

export function ensurePrefixed(name) {
  if (name.startsWith(FILE_PREFIX)) return name;
  return FILE_PREFIX + name;
}

export function toFilePath(filename) {
  if (filename.startsWith('user/files/')) return filename;
  if (filename.startsWith('/user/files/')) return filename.substring(1);
  return `user/files/${ensurePrefixed(filename)}`;
}

export function toFileUrl(filename) {
  const path = toFilePath(filename);
  return path.startsWith('/') ? path : `/${path}`;
}

export async function uploadFile(filename, base64Data) {
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: getRequestHeadersSafe(),
    body: JSON.stringify({ name: ensurePrefixed(filename), data: base64Data })
  });
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`);
  }
  const data = await response.json();
  return data.path;
}

export async function downloadFile(filename) {
  const response = await fetch(toFileUrl(filename), {
    method: 'GET',
    headers: getRequestHeadersSafe()
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return response.text();
}

export async function downloadFileAsBlob(filename) {
  const response = await fetch(toFileUrl(filename), {
    method: 'GET',
    headers: getRequestHeadersSafe()
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return response.blob();
}

export async function deleteFile(filename) {
  const response = await fetch('/api/files/delete', {
    method: 'POST',
    headers: getRequestHeadersSafe(),
    body: JSON.stringify({ path: toFilePath(filename) })
  });
  if (!response.ok) {
    throw new Error(`Delete failed: ${await response.text()}`);
  }
  return true;
}

export async function uploadJSON(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return uploadFile(filename, base64);
}

export async function downloadJSON(filename) {
  const text = await downloadFile(filename);
  return JSON.parse(text);
}

export function getBlueprintFilename(id) {
  return `${FILE_PREFIX}bp-${id}.png`;
}

export function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToDataUrl(bytes, mime = 'image/png') {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function sendProfileRequest(profileId, prompt, responseLength = 512) {
  if (!profileId) return '';
  const service = window.ConnectionManagerRequestService;
  if (!service || typeof service.sendRequest !== 'function') return '';
  const messages = [{ role: 'user', content: prompt }];
  const result = await service.sendRequest(profileId, messages, responseLength, {});
  return (result && (result.text || result.content)) ? (result.text || result.content) : '';
}
