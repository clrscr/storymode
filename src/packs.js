import { baseUrl } from './constants.js';
import { getSettings, saveSettings } from './settings.js';
import { syncBlueprintToLibrary } from './blueprint.js';

export async function loadPacksIndex() {
  try {
    const res = await fetch(`${baseUrl}data/packs/index.json`);
    const json = await res.json();
    return Array.isArray(json.packs) ? json.packs : [];
  } catch (err) {
    console.warn('[Store Mode] Failed to load packs index', err);
    return [];
  }
}

export async function loadPack(packFile) {
  const res = await fetch(`${baseUrl}data/packs/${packFile}`);
  return res.json();
}

function markPackInstalled(packId) {
  const settings = getSettings();
  if (!settings.packs.installed.includes(packId)) {
    settings.packs.installed.push(packId);
    saveSettings();
  }
}

function removePackInstalled(packId) {
  const settings = getSettings();
  settings.packs.installed = settings.packs.installed.filter(id => id !== packId);
  saveSettings();
}

function mergeItems(existing, incoming, packId) {
  const map = new Map(existing.map(item => [item.id, item]));
  incoming.forEach(item => {
    if (!item.id) return;
    const clone = { ...item, source_pack_id: packId };
    map.set(item.id, clone);
  });
  return Array.from(map.values());
}

export async function installPack(pack) {
  const settings = getSettings();
  const data = await loadPack(pack.file);
  if (data.includes?.story_arcs) {
    settings.storyArcs = mergeItems(settings.storyArcs, data.includes.story_arcs, pack.pack_id);
  }
  if (data.includes?.author_styles) {
    settings.authorStyles = mergeItems(settings.authorStyles, data.includes.author_styles, pack.pack_id);
  }
  if (data.includes?.blueprints) {
    settings.blueprints = mergeItems(settings.blueprints, data.includes.blueprints, pack.pack_id);
    data.includes.blueprints.forEach(bp => {
      syncBlueprintToLibrary(bp).catch(() => {});
    });
  }
  markPackInstalled(pack.pack_id);
  saveSettings();
}

export function uninstallPack(packId) {
  const settings = getSettings();
  settings.storyArcs = settings.storyArcs.filter(item => item.source_pack_id !== packId);
  settings.authorStyles = settings.authorStyles.filter(item => item.source_pack_id !== packId);
  settings.blueprints = settings.blueprints.filter(item => item.source_pack_id !== packId);
  removePackInstalled(packId);
  saveSettings();
}

export async function renderPacksUI() {
  const packList = document.getElementById('store-mode-pack-list');
  if (!packList) return;
  packList.innerHTML = '';
  const packs = await loadPacksIndex();
  const settings = getSettings();
  packs.forEach(pack => {
    const row = document.createElement('div');
    row.className = 'store-mode-pack-row';
    const title = document.createElement('div');
    title.textContent = `${pack.name} (${pack.version})`;
    const desc = document.createElement('div');
    desc.textContent = pack.description || '';
    const install = document.createElement('button');
    const installed = settings.packs.installed.includes(pack.pack_id);
    install.textContent = installed ? 'Remove' : 'Install';
    install.addEventListener('click', async () => {
      if (installed) {
        uninstallPack(pack.pack_id);
      } else {
        await installPack(pack);
      }
      renderPacksUI();
    });
    row.appendChild(title);
    row.appendChild(desc);
    row.appendChild(install);
    packList.appendChild(row);
  });
}
