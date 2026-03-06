import { makeId, getConnectionProfiles, sendProfileRequest } from './utils.js';
import { getSettings, saveSettings, getChatState, saveChatState, seedDefaults } from './settings.js';
import { buildInjection, updateExtensionPrompt, getArcName } from './prompts.js';
import { renderTimeline } from './timeline.js';
import { downloadJson, readJsonFile, exportBlueprintPng } from './export.js';
import { extractBlueprintFromPng } from './png.js';
import { upsertBlueprint, loadBlueprintLibrary, loadBlueprintFromLibrary, syncBlueprintToLibrary, removeBlueprintFromLibrary } from './blueprint.js';
import { renderPacksUI } from './packs.js';
import { onUserMessageRendered, onMessageReceived } from './signals.js';
import { toFileUrl } from './utils.js';

// --- Scene/beat editor helpers ---

function parseBeatsText(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [label = '', goal = '', prompt = ''] = line.split('|').map(part => part.trim());
      return { label, goal, prompt };
    });
}

function stringifyBeats(beats) {
  return (beats || []).map(beat => {
    const label = beat.label || '';
    const goal = beat.goal || '';
    const prompt = beat.prompt || '';
    return [label, goal, prompt].join(' | ').trim();
  }).join('\n');
}

function buildScenesEditor(container, scenes) {
  container.innerHTML = '';
  (scenes || []).forEach((scene, index) => {
    const row = document.createElement('div');
    row.className = 'store-mode-scene';

    const titleField = document.createElement('input');
    titleField.value = scene.title || `Scene ${index + 1}`;
    titleField.dataset.role = 'scene-title';

    const beatsField = document.createElement('textarea');
    beatsField.rows = 4;
    beatsField.dataset.role = 'scene-beats';
    beatsField.value = stringifyBeats(scene.beats || []);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove Scene';
    remove.addEventListener('click', () => {
      row.remove();
    });

    row.appendChild(titleField);
    row.appendChild(beatsField);
    row.appendChild(remove);
    container.appendChild(row);
  });
}

function readScenesEditor(container) {
  const scenes = [];
  const rows = Array.from(container.querySelectorAll('.store-mode-scene'));
  rows.forEach(row => {
    const title = row.querySelector('[data-role="scene-title"]')?.value?.trim() || '';
    const beatsText = row.querySelector('[data-role="scene-beats"]')?.value || '';
    const beats = parseBeatsText(beatsText);
    scenes.push({ title, beats });
  });
  return scenes;
}

// --- LLM helpers ---

async function startNewChatWithBlueprint(blueprint) {
  const ctx = SillyTavern.getContext();
  if (typeof ctx.doNewChat === 'function') {
    await ctx.doNewChat();
  }
  setTimeout(async () => {
    const state = getChatState();
    state.activeBlueprintId = blueprint.id;
    state.currentBeatIndex = 0;
    state.currentSceneIndex = 0;
    state.pacingMode = 'scenario';
    state.storyComplete = false;
    await saveChatState();
    updateExtensionPrompt();
    if (blueprint.opening_message && typeof ctx.addOneMessage === 'function') {
      ctx.addOneMessage({
        is_user: false,
        is_system: false,
        name: 'Store Mode',
        send_date: Date.now(),
        mes: blueprint.opening_message
      });
    }
  }, 300);
}

async function runBlueprintWizard() {
  const { Popup } = SillyTavern.getContext();
  const input = async (label) => {
    if (Popup && Popup.show && Popup.show.input) {
      return Popup.show.input('Scenario Blueprint', label, '');
    }
    return window.prompt(label, '');
  };

  const title = await input('Title:');
  if (title === null) return;
  const logline = await input('Logline:');
  if (logline === null) return;
  const genre = await input('Genre:');
  if (genre === null) return;

  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      logline: { type: 'string' },
      genre: { type: 'string' },
      scenes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            beats: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  goal: { type: 'string' },
                  prompt: { type: 'string' }
                },
                required: ['label', 'goal', 'prompt']
              }
            }
          },
          required: ['title', 'beats']
        }
      }
    },
    required: ['title', 'logline', 'genre', 'scenes']
  };

  const { generateRaw } = SillyTavern.getContext();
  const settings = getSettings();
  const prompt = `Generate a scenario blueprint JSON with 3-6 scenes. Title: ${title}. Logline: ${logline}. Genre: ${genre}.`;

  try {
    let raw = '';
    if (settings.llmProfiles.blueprint) {
      raw = await sendProfileRequest(settings.llmProfiles.blueprint, prompt, 800);
    }
    if (!raw) {
      const result = await generateRaw({
        prompt,
        jsonSchema: schema
      });
      raw = typeof result === 'string' ? result : (result && (result.response || result.text || result.output)) || '';
    }
    const blueprint = JSON.parse(raw);
    blueprint.id = makeId('blueprint');
    settings.blueprints.unshift(blueprint);
    saveSettings();
  } catch (err) {
    console.warn('[Store Mode] Blueprint wizard failed', err);
  }
}

async function runExtras(mode) {
  const { generateQuietPrompt, Popup } = SillyTavern.getContext();
  const instructions = {
    summary: 'Generate a concise summary of the story so far.',
    epilogue: 'Write a short epilogue that closes the current story arc.',
    next: 'Suggest what should happen next in the story.'
  };
  const quietPrompt = instructions[mode];
  if (!quietPrompt) return;
  try {
    const result = await generateQuietPrompt({ quietPrompt });
    const output = typeof result === 'string' ? result : (result && (result.response || result.text || result.output)) || '';
    if (Popup && Popup.show && Popup.show.text) {
      await Popup.show.text('Store Mode', output);
    } else {
      window.alert(output);
    }
  } catch (err) {
    console.warn('[Store Mode] Extras generation failed', err);
  }
}

// --- UI rendering ---

export function renderUI() {
  const settingsRoot = document.getElementById('extensions_settings') || document.body;
  if (!settingsRoot || document.getElementById('store-mode-settings')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'store-mode-settings';
  wrapper.className = 'store-mode-settings';
  wrapper.innerHTML = `
    <h3>Store Mode</h3>
    <div class="store-mode-tabs">
      <button data-tab="arcs">Story Arcs</button>
      <button data-tab="authors">Author Styles</button>
      <button data-tab="blueprints">Scenario Blueprints</button>
      <button data-tab="extras">Extras</button>
    </div>

    <div class="store-mode-section" data-section="arcs">
      <div class="store-mode-grid">
        <div>
          <div class="store-mode-field">
            <label>Active Arc</label>
            <select id="store-mode-active-arc"></select>
          </div>
          <div class="store-mode-field">
            <label>Arc Length (messages)</label>
            <input id="store-mode-arc-length" type="number" min="1" />
          </div>
          <div class="store-mode-actions">
            <button id="store-mode-arc-apply">Apply to chat</button>
            <button id="store-mode-arc-clear">Clear selection</button>
          </div>
          <div class="store-mode-list" id="store-mode-arc-list"></div>
          <div class="store-mode-actions">
            <button id="store-mode-arc-new">New</button>
            <button id="store-mode-arc-delete">Delete</button>
            <button id="store-mode-arc-export">Export JSON</button>
            <label class="store-mode-actions">
              <input id="store-mode-arc-import" type="file" accept="application/json" />
            </label>
          </div>
        </div>
        <div>
          <div class="store-mode-field"><label>Title</label><input id="store-mode-arc-title" /></div>
          <div class="store-mode-field"><label>Genre</label><input id="store-mode-arc-genre" /></div>
          <div class="store-mode-field"><label>Tone</label><input id="store-mode-arc-tone" /></div>
          <div class="store-mode-field"><label>Pacing</label><input id="store-mode-arc-pacing" /></div>
          <div class="store-mode-field"><label>Tropes</label><textarea id="store-mode-arc-tropes" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Guidance</label><textarea id="store-mode-arc-guidance" rows="4"></textarea></div>
          <div class="store-mode-field"><label>Story Prompt</label><textarea id="store-mode-arc-story-prompt" rows="4"></textarea></div>
          <div class="store-mode-field"><label>Phase Prompt (Setup)</label><textarea id="store-mode-arc-phase-setup" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Phase Prompt (Confrontation)</label><textarea id="store-mode-arc-phase-confrontation" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Phase Prompt (Resolution)</label><textarea id="store-mode-arc-phase-resolution" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Progress Template</label><input id="store-mode-arc-progress-template" /></div>
          <div class="store-mode-actions">
            <button id="store-mode-arc-save">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="store-mode-section" data-section="authors">
      <div class="store-mode-grid">
        <div>
          <div class="store-mode-field">
            <label>Active Author</label>
            <select id="store-mode-active-author"></select>
          </div>
          <div class="store-mode-actions">
            <button id="store-mode-author-apply">Apply to chat</button>
            <button id="store-mode-author-clear">Clear selection</button>
          </div>
          <div class="store-mode-list" id="store-mode-author-list"></div>
          <div class="store-mode-actions">
            <button id="store-mode-author-new">New</button>
            <button id="store-mode-author-delete">Delete</button>
            <button id="store-mode-author-export">Export JSON</button>
            <label class="store-mode-actions">
              <input id="store-mode-author-import" type="file" accept="application/json" />
            </label>
          </div>
        </div>
        <div>
          <div class="store-mode-field"><label>Name</label><input id="store-mode-author-name" /></div>
          <div class="store-mode-field"><label>Author Prompt</label><textarea id="store-mode-author-prompt" rows="4"></textarea></div>
          <div class="store-mode-field"><label>Style</label><textarea id="store-mode-author-style" rows="4"></textarea></div>
          <div class="store-mode-field"><label>Voice</label><textarea id="store-mode-author-voice" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Notes</label><textarea id="store-mode-author-notes" rows="3"></textarea></div>
          <div class="store-mode-field"><label>NSFW Prompt</label><textarea id="store-mode-author-nsfw" rows="3"></textarea></div>
          <div class="store-mode-field"><label>Keywords (comma-separated)</label><input id="store-mode-author-keywords" /></div>
          <div class="store-mode-actions">
            <button id="store-mode-author-save">Save</button>
          </div>
        </div>
      </div>
    </div>

    <div class="store-mode-section" data-section="blueprints">
      <div class="store-mode-grid">
        <div>
          <div class="store-mode-field">
            <label>Active Blueprint</label>
            <select id="store-mode-active-blueprint"></select>
          </div>
          <div class="store-mode-field">
            <label>Scene / Beat</label>
            <input id="store-mode-blueprint-scene" disabled />
          </div>
          <div class="store-mode-actions">
            <button id="store-mode-blueprint-apply">Apply to chat</button>
            <button id="store-mode-blueprint-clear">Clear selection</button>
          </div>
          <div class="store-mode-list" id="store-mode-blueprint-list"></div>
          <div class="store-mode-field"><label>Library</label></div>
          <div class="store-mode-field store-mode-actions">
            <select id="store-mode-blueprint-library-view">
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </select>
            <select id="store-mode-blueprint-library-sort">
              <option value="recent">Recent</option>
              <option value="title">Title</option>
            </select>
            <label><input type="checkbox" id="store-mode-blueprint-library-favorites" /> Favorites</label>
          </div>
          <div class="store-mode-field"><input id="store-mode-blueprint-library-search" placeholder="Search library..." /></div>
          <div class="store-mode-list" id="store-mode-blueprint-library"></div>
          <div class="store-mode-actions">
            <button id="store-mode-blueprint-new">New</button>
            <button id="store-mode-blueprint-delete">Delete</button>
            <button id="store-mode-blueprint-advance-beat">Next Beat</button>
            <button id="store-mode-blueprint-advance-scene">Next Scene</button>
            <button id="store-mode-blueprint-library-refresh">Refresh Library</button>
            <button id="store-mode-blueprint-export">Export JSON</button>
            <button id="store-mode-blueprint-export-png">Export PNG</button>
            <label class="store-mode-actions">
              <input id="store-mode-blueprint-import" type="file" accept="application/json" />
            </label>
            <label class="store-mode-actions">
              <input id="store-mode-blueprint-import-png" type="file" accept="image/png" />
            </label>
          </div>
        </div>
        <div>
          <div class="store-mode-field"><label>Title</label><input id="store-mode-blueprint-title" /></div>
          <div class="store-mode-field"><label>Logline</label><textarea id="store-mode-blueprint-logline" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Genre</label><input id="store-mode-blueprint-genre" /></div>
          <div class="store-mode-field"><label>Core Premise</label><textarea id="store-mode-blueprint-premise" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Setting (Location)</label><input id="store-mode-blueprint-setting-location" /></div>
          <div class="store-mode-field"><label>Setting (Time Period)</label><input id="store-mode-blueprint-setting-time" /></div>
          <div class="store-mode-field"><label>Setting (Atmosphere)</label><input id="store-mode-blueprint-setting-atmosphere" /></div>
          <div class="store-mode-field"><label>Protagonist Group</label><textarea id="store-mode-blueprint-protagonist" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Antagonistic Forces</label><textarea id="store-mode-blueprint-antagonist" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Arc Structure</label><textarea id="store-mode-blueprint-arc-structure" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Tone and Style</label><textarea id="store-mode-blueprint-tone-style" rows="2"></textarea></div>
          <div class="store-mode-field"><label>Content Boundaries</label><input id="store-mode-blueprint-content-boundaries" /></div>
          <div class="store-mode-field"><label>Opening Message</label><textarea id="store-mode-blueprint-opening" rows="4"></textarea></div>
          <div class="store-mode-field"><label>Scenes & Beats</label></div>
          <div id="store-mode-blueprint-scenes-editor"></div>
          <div class="store-mode-actions">
            <button id="store-mode-blueprint-add-scene">Add Scene</button>
          </div>
          <div class="store-mode-field"><label>Timeline</label></div>
          <div class="store-mode-list" id="store-mode-blueprint-timeline"></div>
          <div class="store-mode-field"><label>Beat Checklist</label></div>
          <div class="store-mode-list" id="store-mode-blueprint-checklist"></div>
          <div class="store-mode-actions">
            <button id="store-mode-blueprint-save">Save</button>
            <button id="store-mode-blueprint-generate">Wizard (LLM)</button>
          </div>
        </div>
      </div>
    </div>

    <div class="store-mode-section" data-section="extras">
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-arcs" /> Enable Story Arcs</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-authors" /> Enable Author Styles</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-blueprints" /> Enable Scenario Blueprints</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-extras" /> Enable Extras</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-nsfw" /> Enable Author NSFW Prompt</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-epilogue" /> Auto Epilogue on Completion</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-summary" /> Auto Summary on Completion</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-next" /> Auto "What's Next" on Completion</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-beat" /> Auto-Beat Detection</label>
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-beat-confirm" /> Confirm Auto-Beat</label>
      </div>
      <div class="store-mode-field">
        <label>Auto-Beat Threshold</label>
        <input id="store-mode-auto-beat-threshold" type="number" min="0" max="1" step="0.05" />
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-auto-beat-advance" /> Auto-Advance on Beat Complete</label>
      </div>
      <div class="store-mode-field"><label>Preset Packs</label></div>
      <div class="store-mode-list" id="store-mode-pack-list"></div>
      <div class="store-mode-actions">
        <button id="store-mode-run-summary">Generate Summary</button>
        <button id="store-mode-run-epilogue">Generate Epilogue</button>
        <button id="store-mode-run-next">Generate What's Next</button>
      </div>
      <div class="store-mode-field"><label>LLM Profile (Arcs)</label><select id="store-mode-profile-arc"></select></div>
      <div class="store-mode-field"><label>LLM Profile (Authors)</label><select id="store-mode-profile-author"></select></div>
      <div class="store-mode-field"><label>LLM Profile (Blueprints)</label><select id="store-mode-profile-blueprint"></select></div>
      <div class="store-mode-field"><label>LLM Profile (Extras)</label><select id="store-mode-profile-extras"></select></div>
      <div class="store-mode-field">
        <label>Prompt Priority</label>
        <input id="store-mode-prompt-priority" type="number" min="-100" max="100" />
      </div>
      <div class="store-mode-field">
        <label><input type="checkbox" id="store-mode-flag-preview" /> Show Prompt Preview</label>
      </div>
      <div class="store-mode-field">
        <label>Prompt Preview</label>
        <textarea id="store-mode-prompt-preview" rows="8" readonly></textarea>
      </div>
    </div>
  `;

  settingsRoot.appendChild(wrapper);
  bindUI(wrapper);
}

function bindUI(wrapper) {
  const settings = getSettings();
  const state = getChatState();

  const tabButtons = wrapper.querySelectorAll('.store-mode-tabs button');
  const sections = wrapper.querySelectorAll('.store-mode-section');

  function activateTab(tabName) {
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    sections.forEach(sec => sec.classList.toggle('active', sec.dataset.section === tabName));
    settings.ui.activeTab = tabName;
    saveSettings();
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  activateTab(settings.ui.activeTab || 'arcs');

  const arcList = wrapper.querySelector('#store-mode-arc-list');
  const arcActive = wrapper.querySelector('#store-mode-active-arc');
  const arcLengthInput = wrapper.querySelector('#store-mode-arc-length');

  const authorList = wrapper.querySelector('#store-mode-author-list');
  const authorActive = wrapper.querySelector('#store-mode-active-author');

  const blueprintList = wrapper.querySelector('#store-mode-blueprint-list');
  const blueprintActive = wrapper.querySelector('#store-mode-active-blueprint');
  const blueprintSceneInput = wrapper.querySelector('#store-mode-blueprint-scene');
  const blueprintLibraryList = wrapper.querySelector('#store-mode-blueprint-library');
  const blueprintLibrarySearch = wrapper.querySelector('#store-mode-blueprint-library-search');
  const blueprintLibraryView = wrapper.querySelector('#store-mode-blueprint-library-view');
  const blueprintLibrarySort = wrapper.querySelector('#store-mode-blueprint-library-sort');
  const blueprintLibraryFavorites = wrapper.querySelector('#store-mode-blueprint-library-favorites');
  const blueprintChecklist = wrapper.querySelector('#store-mode-blueprint-checklist');
  const blueprintTimeline = wrapper.querySelector('#store-mode-blueprint-timeline');
  const autoBeatToggle = wrapper.querySelector('#store-mode-flag-auto-beat');
  const autoBeatConfirm = wrapper.querySelector('#store-mode-flag-auto-beat-confirm');
  const autoBeatThreshold = wrapper.querySelector('#store-mode-auto-beat-threshold');
  const autoBeatAdvance = wrapper.querySelector('#store-mode-flag-auto-beat-advance');
  const profileArcSelect = wrapper.querySelector('#store-mode-profile-arc');
  const profileAuthorSelect = wrapper.querySelector('#store-mode-profile-author');
  const profileBlueprintSelect = wrapper.querySelector('#store-mode-profile-blueprint');
  const profileExtrasSelect = wrapper.querySelector('#store-mode-profile-extras');
  const promptPriorityInput = wrapper.querySelector('#store-mode-prompt-priority');
  const promptPreviewToggle = wrapper.querySelector('#store-mode-flag-preview');
  const promptPreviewArea = wrapper.querySelector('#store-mode-prompt-preview');

  let selectedArcId = null;
  let selectedAuthorId = null;
  let selectedBlueprintId = null;

  function syncActiveSelections() {
    const currentState = getChatState();
    arcActive.value = currentState.activeArcId || '';
    authorActive.value = currentState.activeAuthorId || '';
    blueprintActive.value = currentState.activeBlueprintId || '';
    arcLengthInput.value = currentState.arcLength || settings.arcLengthDefault;
    blueprintSceneInput.value = currentState.activeBlueprintId
      ? `Scene ${currentState.currentSceneIndex + 1} / Beat ${currentState.currentBeatIndex + 1}`
      : '';

    selectedArcId = currentState.activeArcId || selectedArcId;
    selectedAuthorId = currentState.activeAuthorId || selectedAuthorId;
    selectedBlueprintId = currentState.activeBlueprintId || selectedBlueprintId;

    const selectedArc = settings.storyArcs.find(item => item.id === selectedArcId);
    if (selectedArc) fillArcForm(selectedArc);

    const selectedAuthor = settings.authorStyles.find(item => item.id === selectedAuthorId);
    if (selectedAuthor) fillAuthorForm(selectedAuthor);

    const selectedBlueprint = settings.blueprints.find(item => item.id === selectedBlueprintId);
    if (selectedBlueprint) fillBlueprintForm(selectedBlueprint);
  }

  function renderArcList() {
    arcList.innerHTML = '';
    arcActive.innerHTML = '<option value="">None</option>';
    settings.storyArcs.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = getArcName(item) || '(untitled)';
      btn.classList.toggle('active', item.id === selectedArcId);
      btn.addEventListener('click', () => {
        selectedArcId = item.id;
        fillArcForm(item);
        renderArcList();
      });
      arcList.appendChild(btn);

      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = getArcName(item) || '(untitled)';
      opt.selected = item.id === state.activeArcId;
      arcActive.appendChild(opt);
    });
  }

  function renderAuthorList() {
    authorList.innerHTML = '';
    authorActive.innerHTML = '<option value="">None</option>';
    settings.authorStyles.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = item.name || '(untitled)';
      btn.classList.toggle('active', item.id === selectedAuthorId);
      btn.addEventListener('click', () => {
        selectedAuthorId = item.id;
        fillAuthorForm(item);
        renderAuthorList();
      });
      authorList.appendChild(btn);

      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name || '(untitled)';
      opt.selected = item.id === state.activeAuthorId;
      authorActive.appendChild(opt);
    });
  }

  function renderBlueprintList() {
    blueprintList.innerHTML = '';
    blueprintActive.innerHTML = '<option value="">None</option>';
    settings.blueprints.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = item.title || '(untitled)';
      btn.classList.toggle('active', item.id === selectedBlueprintId);
      btn.addEventListener('click', () => {
        selectedBlueprintId = item.id;
        fillBlueprintForm(item);
        renderBlueprintList();
      });
      blueprintList.appendChild(btn);

      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.title || '(untitled)';
      opt.selected = item.id === state.activeBlueprintId;
      blueprintActive.appendChild(opt);
    });
  }

  function renderBlueprintLibrary() {
    blueprintLibraryList.innerHTML = '';
    const currentSettings = getSettings();
    const manifest = currentSettings.blueprintLibrary.manifest;
    const viewMode = currentSettings.blueprintLibrary.view || 'grid';
    const favoritesOnly = currentSettings.blueprintLibrary.favoritesOnly;
    const sortMode = currentSettings.blueprintLibrary.sort || 'recent';

    blueprintLibraryList.classList.toggle('store-mode-library-grid', viewMode === 'grid');
    blueprintLibraryList.classList.toggle('store-mode-library-list', viewMode !== 'grid');

    if (!manifest || !Array.isArray(manifest.blueprints) || !manifest.blueprints.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No library items yet';
      blueprintLibraryList.appendChild(empty);
      return;
    }
    const query = (blueprintLibrarySearch && blueprintLibrarySearch.value || '').toLowerCase();
    let entries = manifest.blueprints.filter(entry => {
      if (!query) return true;
      return (entry.title || '').toLowerCase().includes(query);
    });
    if (favoritesOnly) {
      entries = entries.filter(entry => entry.favorite);
    }
    if (sortMode === 'title') {
      entries.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else {
      entries.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));
    }

    entries.forEach(entry => {
      const card = document.createElement('div');
      card.className = viewMode === 'grid' ? 'store-mode-library-card' : 'store-mode-library-row';

      const cover = document.createElement('img');
      cover.className = 'store-mode-library-cover';
      cover.alt = entry.title || 'Blueprint cover';
      cover.src = entry.filename ? `${toFileUrl(entry.filename)}?t=${encodeURIComponent(entry.modified_at || '')}` : '';

      const titleEl = document.createElement('div');
      titleEl.className = 'store-mode-library-title';
      titleEl.textContent = entry.title || entry.blueprint_id;

      const actions = document.createElement('div');
      actions.className = 'store-mode-library-actions';

      const fav = document.createElement('button');
      fav.textContent = entry.favorite ? '★' : '☆';
      fav.title = 'Toggle favorite';
      fav.addEventListener('click', async (event) => {
        event.stopPropagation();
        entry.favorite = !entry.favorite;
        await syncBlueprintToLibrary(entry);
        renderBlueprintLibrary();
      });

      const load = document.createElement('button');
      load.textContent = 'Open';
      load.addEventListener('click', async (event) => {
        event.stopPropagation();
        const blueprint = await loadBlueprintFromLibrary(entry);
        if (!blueprint) return;
        upsertBlueprint(currentSettings.blueprints, blueprint);
        selectedBlueprintId = blueprint.id;
        fillBlueprintForm(blueprint);
        renderBlueprintList();
        saveSettings();
        updateExtensionPrompt();
      });

      const play = document.createElement('button');
      play.textContent = 'Play';
      play.addEventListener('click', async (event) => {
        event.stopPropagation();
        const blueprint = await loadBlueprintFromLibrary(entry);
        if (!blueprint) return;
        const chatState = getChatState();
        upsertBlueprint(currentSettings.blueprints, blueprint);
        selectedBlueprintId = blueprint.id;
        chatState.activeBlueprintId = blueprint.id;
        chatState.currentBeatIndex = 0;
        chatState.currentSceneIndex = 0;
        chatState.pacingMode = 'scenario';
        chatState.storyComplete = false;
        await saveChatState();
        saveSettings();
        updateExtensionPrompt();
      });

      const playNew = document.createElement('button');
      playNew.textContent = 'New';
      playNew.addEventListener('click', async (event) => {
        event.stopPropagation();
        const blueprint = await loadBlueprintFromLibrary(entry);
        if (!blueprint) return;
        upsertBlueprint(currentSettings.blueprints, blueprint);
        selectedBlueprintId = blueprint.id;
        saveSettings();
        await startNewChatWithBlueprint(blueprint);
      });

      actions.appendChild(fav);
      actions.appendChild(load);
      actions.appendChild(play);
      actions.appendChild(playNew);

      card.appendChild(cover);
      card.appendChild(titleEl);
      card.appendChild(actions);
      blueprintLibraryList.appendChild(card);
    });
  }

  function renderBeatChecklistUI() {
    if (!blueprintChecklist) return;
    blueprintChecklist.innerHTML = '';
    const currentSettings = getSettings();
    const currentState = getChatState();
    const blueprint = currentSettings.blueprints.find(item => item.id === currentState.activeBlueprintId);
    if (!blueprint || !Array.isArray(blueprint.scenes)) {
      blueprintChecklist.textContent = 'No active blueprint.';
      return;
    }
    blueprint.scenes.forEach((scene, sceneIndex) => {
      const sceneHeader = document.createElement('div');
      sceneHeader.textContent = `Scene ${sceneIndex + 1}: ${scene.title || ''}`;
      blueprintChecklist.appendChild(sceneHeader);
      (scene.beats || []).forEach((beat, beatIndex) => {
        const row = document.createElement('div');
        row.className = 'store-mode-beat-row';
        const key = `${sceneIndex}:${beatIndex}`;
        const status = (currentState.beatState && currentState.beatState[key]) || 'pending';
        const label = document.createElement('span');
        label.textContent = `[${status}] ${beat.label || beat.title || 'Beat'}`;

        const complete = document.createElement('button');
        complete.textContent = '✓';
        complete.addEventListener('click', async () => {
          if (!currentState.beatState) currentState.beatState = {};
          currentState.beatState[key] = 'complete';
          await saveChatState();
          renderBeatChecklistUI();
          updateExtensionPrompt();
        });

        const skip = document.createElement('button');
        skip.textContent = 'x';
        skip.addEventListener('click', async () => {
          if (!currentState.beatState) currentState.beatState = {};
          currentState.beatState[key] = 'skipped';
          await saveChatState();
          renderBeatChecklistUI();
          updateExtensionPrompt();
        });

        row.appendChild(label);
        row.appendChild(complete);
        row.appendChild(skip);
        blueprintChecklist.appendChild(row);
      });
    });
  }

  function fillArcForm(item) {
    wrapper.querySelector('#store-mode-arc-title').value = item.title || '';
    wrapper.querySelector('#store-mode-arc-genre').value = item.genre || '';
    wrapper.querySelector('#store-mode-arc-tone').value = item.tone || '';
    wrapper.querySelector('#store-mode-arc-pacing').value = item.pacing || '';
    wrapper.querySelector('#store-mode-arc-tropes').value = item.tropes || '';
    wrapper.querySelector('#store-mode-arc-guidance').value = item.guidance || '';
    wrapper.querySelector('#store-mode-arc-story-prompt').value = item.storyPrompt || '';
    wrapper.querySelector('#store-mode-arc-phase-setup').value = item.phasePrompts ? (item.phasePrompts.setup || '') : '';
    wrapper.querySelector('#store-mode-arc-phase-confrontation').value = item.phasePrompts ? (item.phasePrompts.confrontation || '') : '';
    wrapper.querySelector('#store-mode-arc-phase-resolution').value = item.phasePrompts ? (item.phasePrompts.resolution || '') : '';
    wrapper.querySelector('#store-mode-arc-progress-template').value = item.progressTemplate || '';
  }

  function fillAuthorForm(item) {
    wrapper.querySelector('#store-mode-author-name').value = item.name || '';
    wrapper.querySelector('#store-mode-author-prompt').value = item.authorPrompt || '';
    wrapper.querySelector('#store-mode-author-style').value = item.style || '';
    wrapper.querySelector('#store-mode-author-voice').value = item.voice || '';
    wrapper.querySelector('#store-mode-author-notes').value = item.notes || '';
    wrapper.querySelector('#store-mode-author-nsfw').value = item.nsfwPrompt || '';
    wrapper.querySelector('#store-mode-author-keywords').value = Array.isArray(item.keywords) ? item.keywords.join(', ') : '';
  }

  function fillBlueprintForm(item) {
    wrapper.querySelector('#store-mode-blueprint-title').value = item.title || '';
    wrapper.querySelector('#store-mode-blueprint-logline').value = item.logline || '';
    wrapper.querySelector('#store-mode-blueprint-genre').value = item.genre || '';
    wrapper.querySelector('#store-mode-blueprint-premise').value = item.core_premise || '';
    wrapper.querySelector('#store-mode-blueprint-setting-location').value = item.setting?.location || '';
    wrapper.querySelector('#store-mode-blueprint-setting-time').value = item.setting?.time_period || '';
    wrapper.querySelector('#store-mode-blueprint-setting-atmosphere').value = item.setting?.atmosphere || '';
    wrapper.querySelector('#store-mode-blueprint-protagonist').value = item.protagonist_group?.description || '';
    wrapper.querySelector('#store-mode-blueprint-antagonist').value = item.antagonistic_forces?.description || '';
    wrapper.querySelector('#store-mode-blueprint-arc-structure').value = item.arc_structure?.description || '';
    wrapper.querySelector('#store-mode-blueprint-tone-style').value = item.tone_and_style?.description || '';
    wrapper.querySelector('#store-mode-blueprint-content-boundaries').value = item.content_boundaries || '';
    wrapper.querySelector('#store-mode-blueprint-opening').value = item.opening_message || '';
    const sceneEditor = wrapper.querySelector('#store-mode-blueprint-scenes-editor');
    buildScenesEditor(sceneEditor, item.scenes || []);
  }

  // --- Arc event bindings ---

  arcActive.addEventListener('change', () => {
    selectedArcId = arcActive.value || null;
    const item = settings.storyArcs.find(arc => arc.id === selectedArcId);
    if (item) fillArcForm(item);
  });

  wrapper.querySelector('#store-mode-arc-new').addEventListener('click', () => {
    const newItem = {
      id: makeId('arc'),
      title: 'New Arc',
      name: 'New Arc',
      genre: '',
      tone: '',
      pacing: '',
      tropes: '',
      guidance: '',
      storyPrompt: '',
      progressTemplate: 'Arc Progress: Step {currentStep}/{arcLength} ({arcPercent}% complete). Phase: {phase} - Message {positionInPhase}/{totalInPhase} ({phasePercent}% through {phase}).',
      phasePrompts: {
        setup: '',
        confrontation: '',
        resolution: ''
      }
    };
    settings.storyArcs.unshift(newItem);
    selectedArcId = newItem.id;
    fillArcForm(newItem);
    renderArcList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-arc-save').addEventListener('click', () => {
    if (!selectedArcId) return;
    const item = settings.storyArcs.find(arc => arc.id === selectedArcId);
    if (!item) return;
    item.title = wrapper.querySelector('#store-mode-arc-title').value.trim();
    item.name = item.title;
    item.genre = wrapper.querySelector('#store-mode-arc-genre').value.trim();
    item.tone = wrapper.querySelector('#store-mode-arc-tone').value.trim();
    item.pacing = wrapper.querySelector('#store-mode-arc-pacing').value.trim();
    item.tropes = wrapper.querySelector('#store-mode-arc-tropes').value.trim();
    item.guidance = wrapper.querySelector('#store-mode-arc-guidance').value.trim();
    item.storyPrompt = wrapper.querySelector('#store-mode-arc-story-prompt').value.trim();
    item.progressTemplate = wrapper.querySelector('#store-mode-arc-progress-template').value.trim();
    item.phasePrompts = {
      setup: wrapper.querySelector('#store-mode-arc-phase-setup').value.trim(),
      confrontation: wrapper.querySelector('#store-mode-arc-phase-confrontation').value.trim(),
      resolution: wrapper.querySelector('#store-mode-arc-phase-resolution').value.trim()
    };
    renderArcList();
    saveSettings();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-arc-delete').addEventListener('click', () => {
    if (!selectedArcId) return;
    settings.storyArcs = settings.storyArcs.filter(arc => arc.id !== selectedArcId);
    selectedArcId = null;
    renderArcList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-arc-apply').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeArcId = arcActive.value || null;
    chatState.arcLength = Math.max(parseInt(arcLengthInput.value || settings.arcLengthDefault, 10) || settings.arcLengthDefault, 1);
    chatState.currentStep = 0;
    chatState.storyComplete = false;
    await saveChatState();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-arc-clear').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeArcId = null;
    chatState.currentStep = 0;
    chatState.storyComplete = false;
    arcActive.value = '';
    await saveChatState();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-arc-export').addEventListener('click', () => {
    downloadJson(settings.storyArcs, 'store-mode-story-arcs.json');
  });

  wrapper.querySelector('#store-mode-arc-import').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const items = await readJsonFile(file);
    if (Array.isArray(items)) {
      settings.storyArcs = items;
      renderArcList();
      saveSettings();
    } else if (items !== null) {
      const { toastr } = SillyTavern.getContext();
      toastr && toastr.warning('Store Mode: Story Arcs import failed.');
    }
  });

  // --- Author event bindings ---

  authorActive.addEventListener('change', () => {
    selectedAuthorId = authorActive.value || null;
    const item = settings.authorStyles.find(author => author.id === selectedAuthorId);
    if (item) fillAuthorForm(item);
  });

  wrapper.querySelector('#store-mode-author-new').addEventListener('click', () => {
    const newItem = {
      id: makeId('author'),
      name: 'New Author',
      authorPrompt: '',
      style: '',
      voice: '',
      notes: '',
      nsfwPrompt: '',
      keywords: []
    };
    settings.authorStyles.unshift(newItem);
    selectedAuthorId = newItem.id;
    fillAuthorForm(newItem);
    renderAuthorList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-author-save').addEventListener('click', () => {
    if (!selectedAuthorId) return;
    const item = settings.authorStyles.find(author => author.id === selectedAuthorId);
    if (!item) return;
    item.name = wrapper.querySelector('#store-mode-author-name').value.trim();
    item.authorPrompt = wrapper.querySelector('#store-mode-author-prompt').value.trim();
    item.style = wrapper.querySelector('#store-mode-author-style').value.trim();
    item.voice = wrapper.querySelector('#store-mode-author-voice').value.trim();
    item.notes = wrapper.querySelector('#store-mode-author-notes').value.trim();
    item.nsfwPrompt = wrapper.querySelector('#store-mode-author-nsfw').value.trim();
    const keywords = wrapper.querySelector('#store-mode-author-keywords').value.trim();
    item.keywords = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [];
    renderAuthorList();
    saveSettings();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-author-delete').addEventListener('click', () => {
    if (!selectedAuthorId) return;
    settings.authorStyles = settings.authorStyles.filter(author => author.id !== selectedAuthorId);
    selectedAuthorId = null;
    renderAuthorList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-author-apply').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeAuthorId = authorActive.value || null;
    await saveChatState();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-author-clear').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeAuthorId = null;
    authorActive.value = '';
    await saveChatState();
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-author-export').addEventListener('click', () => {
    downloadJson(settings.authorStyles, 'store-mode-author-styles.json');
  });

  wrapper.querySelector('#store-mode-author-import').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const items = await readJsonFile(file);
    if (Array.isArray(items)) {
      settings.authorStyles = items;
      renderAuthorList();
      saveSettings();
    } else if (items !== null) {
      const { toastr } = SillyTavern.getContext();
      toastr && toastr.warning('Store Mode: Author Styles import failed.');
    }
  });

  // --- Blueprint event bindings ---

  blueprintActive.addEventListener('change', () => {
    selectedBlueprintId = blueprintActive.value || null;
    const item = settings.blueprints.find(bp => bp.id === selectedBlueprintId);
    if (item) fillBlueprintForm(item);
  });

  wrapper.querySelector('#store-mode-blueprint-new').addEventListener('click', () => {
    const newItem = {
      id: makeId('blueprint'),
      title: 'New Blueprint',
      logline: '',
      genre: '',
      core_premise: '',
      setting: { location: '', time_period: '', atmosphere: '' },
      protagonist_group: { description: '' },
      antagonistic_forces: { description: '' },
      arc_structure: { description: '' },
      tone_and_style: { description: '' },
      content_boundaries: '',
      opening_message: '',
      scenes: []
    };
    settings.blueprints.unshift(newItem);
    selectedBlueprintId = newItem.id;
    fillBlueprintForm(newItem);
    renderBlueprintList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-blueprint-save').addEventListener('click', () => {
    if (!selectedBlueprintId) return;
    const item = settings.blueprints.find(blueprint => blueprint.id === selectedBlueprintId);
    if (!item) return;
    item.title = wrapper.querySelector('#store-mode-blueprint-title').value.trim();
    item.logline = wrapper.querySelector('#store-mode-blueprint-logline').value.trim();
    item.genre = wrapper.querySelector('#store-mode-blueprint-genre').value.trim();
    item.core_premise = wrapper.querySelector('#store-mode-blueprint-premise').value.trim();
    item.setting = {
      location: wrapper.querySelector('#store-mode-blueprint-setting-location').value.trim(),
      time_period: wrapper.querySelector('#store-mode-blueprint-setting-time').value.trim(),
      atmosphere: wrapper.querySelector('#store-mode-blueprint-setting-atmosphere').value.trim()
    };
    item.protagonist_group = {
      description: wrapper.querySelector('#store-mode-blueprint-protagonist').value.trim()
    };
    item.antagonistic_forces = {
      description: wrapper.querySelector('#store-mode-blueprint-antagonist').value.trim()
    };
    item.arc_structure = {
      description: wrapper.querySelector('#store-mode-blueprint-arc-structure').value.trim()
    };
    item.tone_and_style = {
      description: wrapper.querySelector('#store-mode-blueprint-tone-style').value.trim()
    };
    item.content_boundaries = wrapper.querySelector('#store-mode-blueprint-content-boundaries').value.trim();
    item.opening_message = wrapper.querySelector('#store-mode-blueprint-opening').value.trim();
    const sceneEditor = wrapper.querySelector('#store-mode-blueprint-scenes-editor');
    item.scenes = readScenesEditor(sceneEditor);
    renderBlueprintList();
    saveSettings();
    syncBlueprintToLibrary(item).catch(err => console.warn('[Store Mode] Blueprint library sync failed', err));
    updateExtensionPrompt();
  });

  wrapper.querySelector('#store-mode-blueprint-delete').addEventListener('click', () => {
    if (!selectedBlueprintId) return;
    settings.blueprints = settings.blueprints.filter(bp => bp.id !== selectedBlueprintId);
    removeBlueprintFromLibrary(selectedBlueprintId).catch(err => console.warn('[Store Mode] Blueprint library delete failed', err));
    selectedBlueprintId = null;
    renderBlueprintList();
    saveSettings();
  });

  wrapper.querySelector('#store-mode-blueprint-apply').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeBlueprintId = blueprintActive.value || null;
    chatState.currentBeatIndex = 0;
    chatState.currentSceneIndex = 0;
    chatState.pacingMode = chatState.activeBlueprintId ? 'scenario' : 'story';
    chatState.storyComplete = false;
    await saveChatState();
    blueprintSceneInput.value = `Scene ${chatState.currentSceneIndex + 1} / Beat ${chatState.currentBeatIndex + 1}`;
    updateExtensionPrompt();
    renderBeatChecklistUI();
  });

  wrapper.querySelector('#store-mode-blueprint-clear').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.activeBlueprintId = null;
    chatState.currentBeatIndex = 0;
    chatState.currentSceneIndex = 0;
    chatState.pacingMode = 'story';
    chatState.storyComplete = false;
    blueprintActive.value = '';
    await saveChatState();
    blueprintSceneInput.value = '';
    updateExtensionPrompt();
    renderBeatChecklistUI();
  });

  wrapper.querySelector('#store-mode-blueprint-export').addEventListener('click', () => {
    downloadJson(settings.blueprints, 'store-mode-blueprints.json');
  });

  wrapper.querySelector('#store-mode-blueprint-export-png').addEventListener('click', () => {
    const item = settings.blueprints.find(bp => bp.id === selectedBlueprintId);
    if (!item) return;
    exportBlueprintPng(item);
  });

  wrapper.querySelector('#store-mode-blueprint-import').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const items = await readJsonFile(file);
    if (Array.isArray(items)) {
      settings.blueprints = items;
      renderBlueprintList();
      saveSettings();
    } else if (items !== null) {
      const { toastr } = SillyTavern.getContext();
      toastr && toastr.warning('Store Mode: Blueprints import failed.');
    }
  });

  wrapper.querySelector('#store-mode-blueprint-import-png').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const blueprint = await extractBlueprintFromPng(file);
      if (!blueprint) {
        const { toastr } = SillyTavern.getContext();
        toastr && toastr.warning('Store Mode: PNG does not contain blueprint data.');
        return;
      }
      const currentSettings = getSettings();
      if (!blueprint.id) blueprint.id = makeId('blueprint');
      upsertBlueprint(currentSettings.blueprints, blueprint);
      selectedBlueprintId = blueprint.id;
      fillBlueprintForm(blueprint);
      renderBlueprintList();
      saveSettings();
      syncBlueprintToLibrary(blueprint).catch(err => console.warn('[Store Mode] Blueprint library sync failed', err));
      renderBlueprintLibrary();
    } catch (err) {
      console.warn('[Store Mode] PNG import failed', err);
      const { toastr } = SillyTavern.getContext();
      toastr && toastr.warning('Store Mode: PNG import failed.');
    }
  });

  wrapper.querySelector('#store-mode-blueprint-generate').addEventListener('click', () => {
    runBlueprintWizard();
  });

  wrapper.querySelector('#store-mode-blueprint-add-scene').addEventListener('click', () => {
    const container = wrapper.querySelector('#store-mode-blueprint-scenes-editor');
    const scene = { title: `Scene ${container.children.length + 1}`, beats: [] };
    const currentScenes = readScenesEditor(container);
    currentScenes.push(scene);
    buildScenesEditor(container, currentScenes);
  });

  wrapper.querySelector('#store-mode-blueprint-library-refresh').addEventListener('click', async () => {
    await loadBlueprintLibrary();
    renderBlueprintLibrary();
  });

  if (blueprintLibrarySearch) {
    blueprintLibrarySearch.addEventListener('input', renderBlueprintLibrary);
  }

  if (blueprintChecklist) {
    blueprintChecklist.addEventListener('storemode-refresh', renderBeatChecklistUI);
  }

  if (blueprintLibraryView) {
    blueprintLibraryView.value = settings.blueprintLibrary.view || 'grid';
    blueprintLibraryView.addEventListener('change', () => {
      settings.blueprintLibrary.view = blueprintLibraryView.value;
      saveSettings();
      renderBlueprintLibrary();
    });
  }

  if (blueprintLibrarySort) {
    blueprintLibrarySort.value = settings.blueprintLibrary.sort || 'recent';
    blueprintLibrarySort.addEventListener('change', () => {
      settings.blueprintLibrary.sort = blueprintLibrarySort.value;
      saveSettings();
      renderBlueprintLibrary();
    });
  }

  if (blueprintLibraryFavorites) {
    blueprintLibraryFavorites.checked = settings.blueprintLibrary.favoritesOnly;
    blueprintLibraryFavorites.addEventListener('change', (e) => {
      settings.blueprintLibrary.favoritesOnly = !!e.target.checked;
      saveSettings();
      renderBlueprintLibrary();
    });
  }

  wrapper.querySelector('#store-mode-blueprint-advance-beat').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.currentBeatIndex = (chatState.currentBeatIndex || 0) + 1;
    if (!chatState.beatState) chatState.beatState = {};
    const key = `${chatState.currentSceneIndex || 0}:${chatState.currentBeatIndex}`;
    chatState.beatState[key] = 'complete';
    await saveChatState();
    blueprintSceneInput.value = `Scene ${chatState.currentSceneIndex + 1} / Beat ${chatState.currentBeatIndex + 1}`;
    updateExtensionPrompt();
    renderBeatChecklistUI();
  });

  wrapper.querySelector('#store-mode-blueprint-advance-scene').addEventListener('click', async () => {
    const chatState = getChatState();
    chatState.currentSceneIndex = (chatState.currentSceneIndex || 0) + 1;
    chatState.currentBeatIndex = 0;
    if (!chatState.beatState) chatState.beatState = {};
    await saveChatState();
    blueprintSceneInput.value = `Scene ${chatState.currentSceneIndex + 1} / Beat ${chatState.currentBeatIndex + 1}`;
    updateExtensionPrompt();
    renderBeatChecklistUI();
  });

  // --- Extras / flags ---

  wrapper.querySelector('#store-mode-flag-arcs').checked = settings.featureFlags.storyArcs;
  wrapper.querySelector('#store-mode-flag-authors').checked = settings.featureFlags.authorStyles;
  wrapper.querySelector('#store-mode-flag-blueprints').checked = settings.featureFlags.blueprints;
  wrapper.querySelector('#store-mode-flag-extras').checked = settings.featureFlags.extras;
  wrapper.querySelector('#store-mode-flag-nsfw').checked = settings.nsfwAuthorStyle;
  wrapper.querySelector('#store-mode-flag-auto-epilogue').checked = settings.extrasOptions.autoEpilogue;
  wrapper.querySelector('#store-mode-flag-auto-summary').checked = settings.extrasOptions.autoSummary;
  wrapper.querySelector('#store-mode-flag-auto-next').checked = settings.extrasOptions.autoNext;
  autoBeatToggle.checked = settings.autoBeat.enabled;
  autoBeatConfirm.checked = settings.autoBeat.confirm;
  autoBeatThreshold.value = settings.autoBeat.threshold;
  autoBeatAdvance.checked = settings.autoBeat.autoAdvance;
  arcLengthInput.value = settings.arcLengthDefault;

  const bindCheckbox = (selector, setter) => {
    const input = wrapper.querySelector(selector);
    if (!input) return;
    input.addEventListener('change', (e) => {
      setter(!!e.target.checked);
      saveSettings();
      updateExtensionPrompt();
    });
  };

  bindCheckbox('#store-mode-flag-arcs', (value) => { settings.featureFlags.storyArcs = value; });
  bindCheckbox('#store-mode-flag-authors', (value) => { settings.featureFlags.authorStyles = value; });
  bindCheckbox('#store-mode-flag-blueprints', (value) => { settings.featureFlags.blueprints = value; });
  bindCheckbox('#store-mode-flag-extras', (value) => { settings.featureFlags.extras = value; });
  bindCheckbox('#store-mode-flag-nsfw', (value) => { settings.nsfwAuthorStyle = value; });
  bindCheckbox('#store-mode-flag-auto-epilogue', (value) => { settings.extrasOptions.autoEpilogue = value; });
  bindCheckbox('#store-mode-flag-auto-summary', (value) => { settings.extrasOptions.autoSummary = value; });
  bindCheckbox('#store-mode-flag-auto-next', (value) => { settings.extrasOptions.autoNext = value; });
  bindCheckbox('#store-mode-flag-auto-beat', (value) => { settings.autoBeat.enabled = value; });
  bindCheckbox('#store-mode-flag-auto-beat-confirm', (value) => { settings.autoBeat.confirm = value; });
  bindCheckbox('#store-mode-flag-auto-beat-advance', (value) => { settings.autoBeat.autoAdvance = value; });

  autoBeatThreshold.addEventListener('change', () => {
    settings.autoBeat.threshold = Math.min(Math.max(parseFloat(autoBeatThreshold.value || '0.75'), 0), 1);
    saveSettings();
  });

  arcLengthInput.addEventListener('change', (e) => {
    settings.arcLengthDefault = Math.max(parseInt(e.target.value || settings.arcLengthDefault, 10) || settings.arcLengthDefault, 1);
    saveSettings();
  });

  wrapper.querySelector('#store-mode-run-summary').addEventListener('click', () => runExtras('summary'));
  wrapper.querySelector('#store-mode-run-epilogue').addEventListener('click', () => runExtras('epilogue'));
  wrapper.querySelector('#store-mode-run-next').addEventListener('click', () => runExtras('next'));

  promptPriorityInput.value = settings.promptOptions.priority;
  promptPreviewToggle.checked = settings.promptOptions.preview;
  promptPreviewArea.value = settings.promptOptions.preview ? buildInjection() : '';

  promptPriorityInput.addEventListener('change', () => {
    settings.promptOptions.priority = parseInt(promptPriorityInput.value || '10', 10) || 10;
    saveSettings();
    updateExtensionPrompt();
    promptPreviewArea.value = settings.promptOptions.preview ? buildInjection() : '';
  });

  promptPreviewToggle.addEventListener('change', (e) => {
    settings.promptOptions.preview = !!e.target.checked;
    saveSettings();
    promptPreviewArea.value = settings.promptOptions.preview ? buildInjection() : '';
  });

  const profiles = getConnectionProfiles();
  const populateProfileSelect = (select, selectedValue) => {
    if (!select) return;
    select.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default API';
    select.appendChild(defaultOpt);
    profiles.forEach(profile => {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.textContent = `${profile.name} (${profile.id})`;
      select.appendChild(opt);
    });
    select.value = selectedValue || '';
  };

  populateProfileSelect(profileArcSelect, settings.llmProfiles.arc);
  populateProfileSelect(profileAuthorSelect, settings.llmProfiles.author);
  populateProfileSelect(profileBlueprintSelect, settings.llmProfiles.blueprint);
  populateProfileSelect(profileExtrasSelect, settings.llmProfiles.extras);

  if (profileArcSelect) {
    profileArcSelect.addEventListener('change', () => {
      settings.llmProfiles.arc = profileArcSelect.value;
      saveSettings();
    });
  }
  if (profileAuthorSelect) {
    profileAuthorSelect.addEventListener('change', () => {
      settings.llmProfiles.author = profileAuthorSelect.value;
      saveSettings();
    });
  }
  if (profileBlueprintSelect) {
    profileBlueprintSelect.addEventListener('change', () => {
      settings.llmProfiles.blueprint = profileBlueprintSelect.value;
      saveSettings();
    });
  }
  if (profileExtrasSelect) {
    profileExtrasSelect.addEventListener('change', () => {
      settings.llmProfiles.extras = profileExtrasSelect.value;
      saveSettings();
    });
  }

  renderArcList();
  renderAuthorList();
  renderBlueprintList();
  renderBlueprintLibrary();
  syncActiveSelections();
  renderBeatChecklistUI();
  renderPacksUI();
  const activeBlueprint = settings.blueprints.find(item => item.id === getChatState().activeBlueprintId);
  renderTimeline(blueprintTimeline, activeBlueprint, getChatState());
}

export async function init() {
  await seedDefaults();
  await loadBlueprintLibrary();

  const { eventSource, event_types } = SillyTavern.getContext();
  eventSource.on(event_types.APP_READY, renderUI);
  if (event_types.USER_MESSAGE_RENDERED) {
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
  }
  if (event_types.MESSAGE_RECEIVED) {
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
  }
  if (event_types.CHAT_CHANGED) {
    eventSource.on(event_types.CHAT_CHANGED, () => {
      const panel = document.getElementById('store-mode-settings');
      if (!panel) return;
      const currentSettings = getSettings();
      const currentState = getChatState();
      const arcActive = panel.querySelector('#store-mode-active-arc');
      const authorActive = panel.querySelector('#store-mode-active-author');
      const blueprintActive = panel.querySelector('#store-mode-active-blueprint');
      const arcLengthInput = panel.querySelector('#store-mode-arc-length');
      const blueprintSceneInput = panel.querySelector('#store-mode-blueprint-scene');
      const promptPreviewArea = panel.querySelector('#store-mode-prompt-preview');
      const promptPreviewToggle = panel.querySelector('#store-mode-flag-preview');
      if (arcActive) arcActive.value = currentState.activeArcId || '';
      if (authorActive) authorActive.value = currentState.activeAuthorId || '';
      if (blueprintActive) blueprintActive.value = currentState.activeBlueprintId || '';
      if (arcLengthInput) arcLengthInput.value = currentState.arcLength || currentSettings.arcLengthDefault;
      if (blueprintSceneInput) {
        blueprintSceneInput.value = currentState.activeBlueprintId
          ? `Scene ${currentState.currentSceneIndex + 1} / Beat ${currentState.currentBeatIndex + 1}`
          : '';
      }
      if (promptPreviewArea && promptPreviewToggle && promptPreviewToggle.checked) {
        promptPreviewArea.value = buildInjection();
      }
      const blueprintTimeline = panel.querySelector('#store-mode-blueprint-timeline');
      if (blueprintTimeline) {
        const blueprint = currentSettings.blueprints.find(item => item.id === currentState.activeBlueprintId);
        renderTimeline(blueprintTimeline, blueprint, currentState);
      }
    });
  }
}
