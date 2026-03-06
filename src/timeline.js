import { getChatState, saveChatState } from './settings.js';
import { updateExtensionPrompt } from './prompts.js';

export function renderTimeline(container, blueprint, state) {
  if (!container) return;
  container.innerHTML = '';
  if (!blueprint || !Array.isArray(blueprint.scenes)) {
    container.textContent = 'No active blueprint.';
    return;
  }
  blueprint.scenes.forEach((scene, sceneIndex) => {
    const sceneRow = document.createElement('div');
    sceneRow.className = 'store-mode-timeline-scene';
    const header = document.createElement('div');
    header.textContent = `Scene ${sceneIndex + 1}: ${scene.title || ''}`;
    sceneRow.appendChild(header);

    (scene.beats || []).forEach((beat, beatIndex) => {
      const row = document.createElement('div');
      row.className = 'store-mode-timeline-beat';
      const key = `${sceneIndex}:${beatIndex}`;
      const status = (state.beatState && state.beatState[key]) || 'pending';
      const marker = status === 'complete' ? '✓' : status === 'skipped' ? 'x' : '→';
      row.textContent = `[${marker}] ${beat.label || beat.title || 'Beat'} — ${beat.goal || ''}`;
      row.addEventListener('click', async () => {
        const currentState = getChatState();
        currentState.currentSceneIndex = sceneIndex;
        currentState.currentBeatIndex = beatIndex;
        await saveChatState();
        updateExtensionPrompt();
      });
      sceneRow.appendChild(row);
    });
    container.appendChild(sceneRow);
  });
}
