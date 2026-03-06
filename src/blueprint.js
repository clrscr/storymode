import { MANIFEST_FILENAME, getBlueprintFilename, uploadFile, downloadJSON, uploadJSON, downloadFileAsBlob, deleteFile } from './utils.js';
import { getSettings, saveSettings } from './settings.js';
import { extractTextChunks, embedBlueprintInPng } from './png.js';
import { generateBlueprintPngDataUrl } from './export.js';

export function upsertBlueprint(list, blueprint) {
  const index = list.findIndex(item => item.id === blueprint.id);
  if (index >= 0) {
    list[index] = blueprint;
  } else {
    list.push(blueprint);
  }
}

export async function loadBlueprintLibrary() {
  const settings = getSettings();
  if (!settings.blueprintLibrary.enabled) return;
  try {
    const manifest = await downloadJSON(MANIFEST_FILENAME);
    settings.blueprintLibrary.manifest = manifest;
    settings.blueprintLibrary.manifestLoaded = true;
    saveSettings();
  } catch (err) {
    settings.blueprintLibrary.manifestLoaded = false;
    settings.blueprintLibrary.manifest = { version: 1, blueprints: [] };
    saveSettings();
  }
}

export async function loadBlueprintFromLibrary(entry) {
  if (!entry || !entry.filename) return null;
  try {
    const blob = await downloadFileAsBlob(entry.filename);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunks = extractTextChunks(bytes);
    if (chunks.STOREMODE_JSON) {
      return JSON.parse(chunks.STOREMODE_JSON);
    }
  } catch (err) {
    console.warn('[Store Mode] Failed to load blueprint from library', err);
  }
  return null;
}

async function saveBlueprintLibrary() {
  const settings = getSettings();
  if (!settings.blueprintLibrary.enabled) return;
  const manifest = settings.blueprintLibrary.manifest || { version: 1, blueprints: [] };
  settings.blueprintLibrary.manifest = manifest;
  await uploadJSON(MANIFEST_FILENAME, manifest);
}

export async function syncBlueprintToLibrary(blueprint) {
  const settings = getSettings();
  if (!settings.blueprintLibrary.enabled) return;
  const manifest = settings.blueprintLibrary.manifest || { version: 1, blueprints: [] };
  const existing = manifest.blueprints.find(entry => entry.blueprint_id === blueprint.id);
  const now = new Date().toISOString();
  const filename = getBlueprintFilename(blueprint.id);
  const dataUrl = generateBlueprintPngDataUrl(blueprint);
  const embedded = embedBlueprintInPng(dataUrl, blueprint);
  const base64 = embedded.split(',')[1];

  await uploadFile(filename, base64);
  const entry = {
    blueprint_id: blueprint.id,
    title: blueprint.title || '',
    created_at: existing ? existing.created_at : now,
    modified_at: now,
    filename: filename,
    favorite: existing ? !!existing.favorite : false
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    manifest.blueprints.push(entry);
  }
  settings.blueprintLibrary.manifest = manifest;
  await saveBlueprintLibrary();
}

export async function removeBlueprintFromLibrary(blueprintId) {
  const settings = getSettings();
  if (!settings.blueprintLibrary.enabled) return;
  const manifest = settings.blueprintLibrary.manifest;
  if (!manifest || !Array.isArray(manifest.blueprints)) return;
  const entry = manifest.blueprints.find(item => item.blueprint_id === blueprintId);
  if (entry && entry.filename) {
    try {
      await deleteFile(entry.filename);
    } catch (err) {
      console.warn('[Store Mode] Failed to delete blueprint file', err);
    }
  }
  manifest.blueprints = manifest.blueprints.filter(item => item.blueprint_id !== blueprintId);
  await saveBlueprintLibrary();
}
