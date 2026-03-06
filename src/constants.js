export const MODULE_NAME = 'store_mode';
export const MODULE_LABEL = 'Store Mode';

export const baseUrl = new URL('.', import.meta.url).href;

export const defaultSettings = Object.freeze({
  enabled: true,
  featureFlags: {
    storyArcs: true,
    authorStyles: true,
    blueprints: true,
    extras: true
  },
  arcLengthDefault: 30,
  nsfwAuthorStyle: false,
  blueprintLibrary: {
    enabled: true,
    manifestLoaded: false,
    manifest: null,
    view: 'grid',
    favoritesOnly: false,
    sort: 'recent'
  },
  autoBeat: {
    enabled: false,
    confirm: true,
    threshold: 0.75,
    autoAdvance: false
  },
  packs: {
    installed: []
  },
  promptOptions: {
    priority: 10,
    preview: true
  },
  extrasOptions: {
    autoEpilogue: true,
    autoSummary: false,
    autoNext: false
  },
  storyArcs: [],
  authorStyles: [],
  blueprints: [],
  llmProfiles: {
    arc: '',
    author: '',
    blueprint: '',
    extras: ''
  },
  ui: {
    activeTab: 'arcs'
  },
  seed: {
    arcs: false,
    authors: false
  }
});
