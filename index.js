(() => {
  const MODULE_NAME = 'store_mode';
  const MODULE_LABEL = 'Store Mode';
  const scriptElement = document.currentScript || Array.from(document.scripts).find((script) => {
    if (!script.src) return false;
    if (!script.src.includes('/scripts/extensions/third-party/')) return false;
    if (!script.src.endsWith('/index.js')) return false;
    return script.src.toLowerCase().includes('storymode');
  });
  const scriptUrl = scriptElement && scriptElement.src ? scriptElement.src : '';
  const baseUrl = scriptUrl
    ? scriptUrl.slice(0, scriptUrl.lastIndexOf('/') + 1)
    : '/scripts/extensions/third-party/storymode/';

  const defaultSettings = Object.freeze({
    enabled: true,
    featureFlags: {
      storyArcs: true,
      authorStyles: true,
      blueprints: true,
      extras: true
    },
    arcLengthDefault: 30,
    nsfwAuthorStyle: false,
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

  function deepClone(value) {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function getSettings() {
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

  function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
  }

  function getChatState() {
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
        storyComplete: false
      };
    }
    return chatMetadata[MODULE_NAME];
  }

  async function saveChatState() {
    const { saveMetadata } = SillyTavern.getContext();
    await saveMetadata();
  }

  function makeId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function seedDefaults() {
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

  function buildInjection() {
    const settings = getSettings();
    if (!settings.enabled) return '';

    const state = getChatState();
    const arc = settings.storyArcs.find(item => item.id === state.activeArcId);
    const author = settings.authorStyles.find(item => item.id === state.activeAuthorId);
    const blueprint = settings.blueprints.find(item => item.id === state.activeBlueprintId);

    const sections = [];
    if (settings.featureFlags.storyArcs && arc) {
      const phaseInfo = getPhaseInfo(state.currentStep, state.arcLength);
      const storyPrompt = arc.storyPrompt || buildStoryPrompt(arc);
      const phasePrompt = arc.phasePrompts ? arc.phasePrompts[phaseInfo.phase] : '';
      const progressLine = formatProgress(arc.progressTemplate, phaseInfo);

      sections.push([
        `Story Type\nName: ${getArcName(arc)}`,
        storyPrompt ? `Story Prompt: ${storyPrompt}` : '',
        phasePrompt ? `Phase Prompt (${phaseInfo.phase}): ${phasePrompt}` : '',
        progressLine ? progressLine : ''
      ].filter(Boolean).join('\n'));
    }
    if (settings.featureFlags.authorStyles && author) {
      const prompt = author.authorPrompt || buildAuthorPrompt(author);
      const nsfw = settings.nsfwAuthorStyle && author.nsfwPrompt ? `NSFW Guidance: ${author.nsfwPrompt}` : '';
      sections.push([
        `Author Style\nName: ${author.name || ''}`,
        prompt ? `Author Prompt: ${prompt}` : '',
        nsfw
      ].filter(Boolean).join('\n'));
    }
    if (settings.featureFlags.blueprints && blueprint) {
      const beat = getCurrentBeat(blueprint, state.currentBeatIndex);
      if (beat) {
        const signalHint = state.pacingMode === 'scenario'
          ? 'Use @@BEAT:N@@, @@NEXT_SCENE@@, @@STORY_COMPLETE@@ signals at the end of responses.'
          : '';
        sections.push(`Scenario Blueprint\nTitle: ${blueprint.title || ''}\nCurrent Beat: ${beat.label || ''}\nGoal: ${beat.goal || ''}\nPrompt: ${beat.prompt || ''}\n${signalHint}`.trim());
      }
    }

    if (!sections.length) return '';
    return `Store Mode Guidance\n\n${sections.join('\n\n')}`;
  }

  function getCurrentBeat(blueprint, beatIndex) {
    if (!blueprint || !Array.isArray(blueprint.scenes)) return null;
    const beats = blueprint.scenes.flatMap(scene => scene.beats || []);
    if (!beats.length) return null;
    return beats[Math.min(beatIndex, beats.length - 1)];
  }

  function getArcName(arc) {
    return arc.name || arc.title || '';
  }

  function buildStoryPrompt(arc) {
    const parts = [
      arc.storyPrompt,
      arc.guidance,
      arc.tone ? `Tone: ${arc.tone}` : '',
      arc.pacing ? `Pacing: ${arc.pacing}` : '',
      arc.tropes ? `Tropes: ${arc.tropes}` : '',
      arc.genre ? `Genre: ${arc.genre}` : '',
      Array.isArray(arc.category) ? `Category: ${arc.category.join(', ')}` : ''
    ].filter(Boolean);
    return parts.join(' ');
  }

  function buildAuthorPrompt(author) {
    const parts = [
      author.authorPrompt,
      author.style,
      author.voice,
      author.notes,
      Array.isArray(author.keywords) ? `Keywords: ${author.keywords.join(', ')}` : ''
    ].filter(Boolean);
    return parts.join(' ');
  }

  function getPhaseInfo(currentStep, arcLength) {
    const safeLength = Math.max(arcLength || 1, 1);
    const step = Math.max(currentStep || 0, 0);
    const arcPercent = Math.min(Math.round((step / safeLength) * 100), 100);
    const phase = arcPercent < 34 ? 'setup' : arcPercent < 67 ? 'confrontation' : 'resolution';
    const totalInPhase = Math.ceil(safeLength / 3);
    const positionInPhase = Math.min(step % totalInPhase, totalInPhase);
    const phasePercent = Math.min(Math.round((positionInPhase / totalInPhase) * 100), 100);
    return {
      currentStep: step,
      arcLength: safeLength,
      arcPercent,
      phase,
      positionInPhase,
      totalInPhase,
      phasePercent
    };
  }

  function formatProgress(template, phaseInfo) {
    if (!template) return '';
    return template
      .replace('{currentStep}', phaseInfo.currentStep)
      .replace('{arcLength}', phaseInfo.arcLength)
      .replace('{arcPercent}', phaseInfo.arcPercent)
      .replace('{phase}', phaseInfo.phase)
      .replace('{positionInPhase}', phaseInfo.positionInPhase)
      .replace('{totalInPhase}', phaseInfo.totalInPhase)
      .replace('{phasePercent}', phaseInfo.phasePercent);
  }

  globalThis.storeModeGenerateInterceptor = async function (chat, contextSize, abort, type) {
    if (type === 'quiet') return;
    const injection = buildInjection();
    if (!injection) return;

    const systemNote = {
      is_user: false,
      is_system: true,
      name: 'Store Mode',
      send_date: Date.now(),
      mes: injection
    };

    const insertIndex = Math.max(chat.length - 1, 0);
    chat.splice(insertIndex, 0, systemNote);
  };

  function renderUI() {
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
            <div class="store-mode-actions">
              <button id="store-mode-blueprint-apply">Apply to chat</button>
              <button id="store-mode-blueprint-clear">Clear selection</button>
            </div>
            <div class="store-mode-list" id="store-mode-blueprint-list"></div>
            <div class="store-mode-actions">
              <button id="store-mode-blueprint-new">New</button>
              <button id="store-mode-blueprint-delete">Delete</button>
              <button id="store-mode-blueprint-export">Export JSON</button>
              <button id="store-mode-blueprint-export-png">Export PNG</button>
              <label class="store-mode-actions">
                <input id="store-mode-blueprint-import" type="file" accept="application/json" />
              </label>
            </div>
          </div>
          <div>
            <div class="store-mode-field"><label>Title</label><input id="store-mode-blueprint-title" /></div>
            <div class="store-mode-field"><label>Logline</label><textarea id="store-mode-blueprint-logline" rows="2"></textarea></div>
            <div class="store-mode-field"><label>Genre</label><input id="store-mode-blueprint-genre" /></div>
            <div class="store-mode-field"><label>Scenes/Beats (JSON)</label><textarea id="store-mode-blueprint-scenes" rows="10"></textarea></div>
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
        <div class="store-mode-actions">
          <button id="store-mode-run-summary">Generate Summary</button>
          <button id="store-mode-run-epilogue">Generate Epilogue</button>
          <button id="store-mode-run-next">Generate What's Next</button>
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

    let selectedArcId = null;
    let selectedAuthorId = null;
    let selectedBlueprintId = null;

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
      wrapper.querySelector('#store-mode-blueprint-scenes').value = JSON.stringify(item.scenes || [], null, 2);
    }

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
    });

    wrapper.querySelector('#store-mode-arc-delete').addEventListener('click', () => {
      if (!selectedArcId) return;
      settings.storyArcs = settings.storyArcs.filter(arc => arc.id !== selectedArcId);
      selectedArcId = null;
      renderArcList();
      saveSettings();
    });

    wrapper.querySelector('#store-mode-arc-apply').addEventListener('click', async () => {
      const state = getChatState();
      state.activeArcId = arcActive.value || null;
      state.arcLength = Math.max(parseInt(arcLengthInput.value || settings.arcLengthDefault, 10) || settings.arcLengthDefault, 1);
      state.currentStep = 0;
      state.storyComplete = false;
      await saveChatState();
    });

    wrapper.querySelector('#store-mode-arc-clear').addEventListener('click', async () => {
      const state = getChatState();
      state.activeArcId = null;
      state.currentStep = 0;
      state.storyComplete = false;
      arcActive.value = '';
      await saveChatState();
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
      }
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
    });

    wrapper.querySelector('#store-mode-author-delete').addEventListener('click', () => {
      if (!selectedAuthorId) return;
      settings.authorStyles = settings.authorStyles.filter(author => author.id !== selectedAuthorId);
      selectedAuthorId = null;
      renderAuthorList();
      saveSettings();
    });

    wrapper.querySelector('#store-mode-author-apply').addEventListener('click', async () => {
      const state = getChatState();
      state.activeAuthorId = authorActive.value || null;
      await saveChatState();
    });

    wrapper.querySelector('#store-mode-author-clear').addEventListener('click', async () => {
      const state = getChatState();
      state.activeAuthorId = null;
      authorActive.value = '';
      await saveChatState();
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
      }
    });

    wrapper.querySelector('#store-mode-blueprint-new').addEventListener('click', () => {
      const newItem = {
        id: makeId('blueprint'),
        title: 'New Blueprint',
        logline: '',
        genre: '',
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
      try {
        item.scenes = JSON.parse(wrapper.querySelector('#store-mode-blueprint-scenes').value || '[]');
      } catch (err) {
        console.warn('[Store Mode] Invalid blueprint scenes JSON', err);
      }
      renderBlueprintList();
      saveSettings();
    });

    wrapper.querySelector('#store-mode-blueprint-delete').addEventListener('click', () => {
      if (!selectedBlueprintId) return;
      settings.blueprints = settings.blueprints.filter(bp => bp.id !== selectedBlueprintId);
      selectedBlueprintId = null;
      renderBlueprintList();
      saveSettings();
    });

    wrapper.querySelector('#store-mode-blueprint-apply').addEventListener('click', async () => {
      const state = getChatState();
      state.activeBlueprintId = blueprintActive.value || null;
      state.currentBeatIndex = 0;
      state.currentSceneIndex = 0;
      state.pacingMode = state.activeBlueprintId ? 'scenario' : 'story';
      state.storyComplete = false;
      await saveChatState();
    });

    wrapper.querySelector('#store-mode-blueprint-clear').addEventListener('click', async () => {
      const state = getChatState();
      state.activeBlueprintId = null;
      state.currentBeatIndex = 0;
      state.currentSceneIndex = 0;
      state.pacingMode = 'story';
      state.storyComplete = false;
      blueprintActive.value = '';
      await saveChatState();
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
      }
    });

    wrapper.querySelector('#store-mode-blueprint-generate').addEventListener('click', () => {
      runBlueprintWizard();
    });

    wrapper.querySelector('#store-mode-flag-arcs').checked = settings.featureFlags.storyArcs;
    wrapper.querySelector('#store-mode-flag-authors').checked = settings.featureFlags.authorStyles;
    wrapper.querySelector('#store-mode-flag-blueprints').checked = settings.featureFlags.blueprints;
    wrapper.querySelector('#store-mode-flag-extras').checked = settings.featureFlags.extras;
    wrapper.querySelector('#store-mode-flag-nsfw').checked = settings.nsfwAuthorStyle;

    arcLengthInput.value = settings.arcLengthDefault;

    wrapper.querySelector('#store-mode-flag-arcs').addEventListener('change', (e) => {
      settings.featureFlags.storyArcs = e.target.checked;
      saveSettings();
    });
    wrapper.querySelector('#store-mode-flag-authors').addEventListener('change', (e) => {
      settings.featureFlags.authorStyles = e.target.checked;
      saveSettings();
    });
    wrapper.querySelector('#store-mode-flag-blueprints').addEventListener('change', (e) => {
      settings.featureFlags.blueprints = e.target.checked;
      saveSettings();
    });
    wrapper.querySelector('#store-mode-flag-extras').addEventListener('change', (e) => {
      settings.featureFlags.extras = e.target.checked;
      saveSettings();
    });

    wrapper.querySelector('#store-mode-flag-nsfw').addEventListener('change', (e) => {
      settings.nsfwAuthorStyle = e.target.checked;
      saveSettings();
    });

    arcLengthInput.addEventListener('change', (e) => {
      settings.arcLengthDefault = Math.max(parseInt(e.target.value || settings.arcLengthDefault, 10) || settings.arcLengthDefault, 1);
      saveSettings();
    });

    wrapper.querySelector('#store-mode-run-summary').addEventListener('click', () => runExtras('summary'));
    wrapper.querySelector('#store-mode-run-epilogue').addEventListener('click', () => runExtras('epilogue'));
    wrapper.querySelector('#store-mode-run-next').addEventListener('click', () => runExtras('next'));

    renderArcList();
    renderAuthorList();
    renderBlueprintList();
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
    const prompt = `Generate a scenario blueprint JSON with 3-6 scenes. Title: ${title}. Logline: ${logline}. Genre: ${genre}.`;

    try {
      const result = await generateRaw({
        prompt,
        jsonSchema: schema
      });
      const raw = typeof result === 'string' ? result : (result && (result.response || result.text || result.output)) || '';
      const blueprint = JSON.parse(raw);
      const settings = getSettings();
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

  function parseStorySignals(text) {
    const signals = [];
    let cleanText = text;
    const patterns = [
      { type: 'BEAT', regex: /@@BEAT:(\d+)@@/g },
      { type: 'SKIP', regex: /@@SKIP:(\d+)@@/g },
      { type: 'NEXT_SCENE', regex: /@@NEXT_SCENE@@/g },
      { type: 'STORY_COMPLETE', regex: /@@STORY_COMPLETE@@/g }
    ];
    patterns.forEach((pattern) => {
      const matches = [...cleanText.matchAll(pattern.regex)];
      matches.forEach((match) => {
        signals.push({ type: pattern.type, value: match[1] });
      });
      cleanText = cleanText.replace(pattern.regex, '');
    });
    return { cleanText: cleanText.trim(), signals };
  }

  async function onUserMessageRendered() {
    const settings = getSettings();
    if (!settings.enabled || !settings.featureFlags.storyArcs) return;
    const state = getChatState();
    if (!state.activeArcId || state.pacingMode !== 'story') return;
    if (state.storyComplete) return;
    state.currentStep = (state.currentStep || 0) + 1;
    if (state.currentStep >= state.arcLength) {
      state.storyComplete = true;
    }
    await saveChatState();
  }

  async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;
    const state = getChatState();
    if (state.pacingMode !== 'scenario') return;

    const ctx = SillyTavern.getContext();
    const chat = ctx.chat;
    if (!chat || typeof messageId !== 'number') return;
    const message = chat[messageId];
    if (!message) return;

    const text = message.mes || message.text || '';
    const { cleanText, signals } = parseStorySignals(text);
    if (!signals.length) return;

    message.mes = cleanText;
    if (ctx.saveChatConditional) {
      ctx.saveChatConditional();
    } else if (ctx.saveMetadata) {
      await ctx.saveMetadata();
    }

    signals.forEach((signal) => {
      if (signal.type === 'BEAT' || signal.type === 'SKIP') {
        const beatIndex = Math.max(parseInt(signal.value || '0', 10), 0);
        state.currentBeatIndex = Math.max(state.currentBeatIndex || 0, beatIndex);
      }
      if (signal.type === 'NEXT_SCENE') {
        state.currentSceneIndex = (state.currentSceneIndex || 0) + 1;
        state.currentBeatIndex = 0;
      }
      if (signal.type === 'STORY_COMPLETE') {
        state.storyComplete = true;
      }
    });

    await saveChatState();
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function readJsonFile(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return parsed.items ? parsed.items : parsed;
  }

  function exportBlueprintPng(blueprint) {
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

    const link = document.createElement('a');
    link.download = `${(blueprint.title || 'blueprint').replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
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

  async function init() {
    await seedDefaults();

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.APP_READY, renderUI);
    if (event_types.USER_MESSAGE_RENDERED) {
      eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    }
    if (event_types.MESSAGE_RECEIVED) {
      eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }
  }

  init();
})();
