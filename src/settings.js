import { MODULE_NAME, defaultSettings, baseUrl } from './constants.js';
import { deepClone } from './utils.js';

export function getSettings() {
  const { extensionSettings } = SillyTavern.getContext();
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = deepClone(defaultSettings);
  } else {
    const { lodash } = SillyTavern.libs;
    extensionSettings[MODULE_NAME] = lodash.merge(
      deepClone(defaultSettings),
      extensionSettings[MODULE_NAME]
    );
  }
  return extensionSettings[MODULE_NAME];
}

export function saveSettings() {
  const { saveSettingsDebounced } = SillyTavern.getContext();
  saveSettingsDebounced();
}

export function getChatState() {
  const { chatMetadata } = SillyTavern.getContext();
  if (!chatMetadata[MODULE_NAME]) {
    chatMetadata[MODULE_NAME] = {
      activeArcId: null,
      activeAuthorId: null,
      activeBlueprintId: null,
      currentBeatIndex: 0,
      currentSceneIndex: 0,
      currentStep: 0,
      arcLength: 30,
      pacingMode: 'story',
      storyComplete: false,
      epilogueDone: false,
      summaryDone: false,
      nextDone: false,
      beatState: {}
    };
  }
  return chatMetadata[MODULE_NAME];
}

export async function saveChatState() {
  const { saveMetadata } = SillyTavern.getContext();
  await saveMetadata();
}

export async function seedDefaults() {
  const settings = getSettings();
  const { toastr } = SillyTavern.getContext();

  if (!settings.seed.arcs) {
    try {
      const res = await fetch(`${baseUrl}data/story_arcs.json`);
      const json = await res.json();
      const items = Array.isArray(json) ? json : json.items;
      if (Array.isArray(items) && items.length) {
        settings.storyArcs = items;
      }
      settings.seed.arcs = true;
    } catch (err) {
      console.warn('[Store Mode] Failed to load story_arcs.json', err);
      toastr && toastr.warning('Store Mode: failed to load Story Arcs seed data.');
    }
  }

  if (!settings.seed.authors) {
    try {
      const res = await fetch(`${baseUrl}data/author_styles.json`);
      const json = await res.json();
      const items = Array.isArray(json) ? json : json.items;
      if (Array.isArray(items) && items.length) {
        settings.authorStyles = items;
      }
      settings.seed.authors = true;
    } catch (err) {
      console.warn('[Store Mode] Failed to load author_styles.json', err);
      toastr && toastr.warning('Store Mode: failed to load Author Styles seed data.');
    }
  }

  saveSettings();
}
