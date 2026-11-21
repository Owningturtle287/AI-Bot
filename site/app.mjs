import { generate, makeModel, matchExample, parameters, WIDTHS } from './model.mjs';
import { read, save, saveCheckpoint } from './storage.mjs';

const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat();
const state = { profiles: [], chats: [], chat: null, dataset: null, job: null, loadingPack: false, sending: false };
const activeProfile = () => state.profiles.find(profile => profile.id === state.chat?.profileId) || state.profiles[0];
const layout = $('layout');
const input = $('message');
const modelSelect = $('chat-model');
const modeSelect = $('answer-mode');
const trainButton = $('train');
const dropzone = $('dropzone');
const fileInput = $('file');
const notice = $('notice');
const workOverlay = matchMedia('(max-width: 990px)');
const chatOverlay = matchMedia('(max-width: 680px)');

function option(label, value) {
  return new Option(label, value);
}

function formatBytes(bytes) {
  for (const [unit, divisor] of [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]]) {
    if (bytes >= divisor) return (bytes / divisor).toFixed(1) + ' ' + unit;
  }
  return bytes + ' bytes';
}

function say(message = '', error = false) {
  notice.hidden = !message;
  notice.classList.toggle('error', error);
  notice.textContent = message;
}

function saveError(error) {
  say('Could not save on this device. ' + (error?.message || 'Check the browser’s storage settings.'), true);
  panel('workshop');
}

function panel(which = '') {
  const workshop = which === 'workshop' && workOverlay.matches;
  const sidebar = which === 'sidebar' && chatOverlay.matches;
  layout.classList.toggle('show-workshop', workshop);
  layout.classList.toggle('show-sidebar', sidebar);
  $('toggle-workshop').setAttribute('aria-expanded', String(workshop));
  $('toggle-sidebar').setAttribute('aria-expanded', String(sidebar));
  $('scrim').hidden = !workshop && !sidebar;
  document.querySelector('.chat').inert = workshop || sidebar;
  $('sidebar').inert = workshop;
  $('workshop').inert = sidebar;
}

function selectPanel(which, trigger, focus) {
  const overlay = which === 'workshop' ? workOverlay : chatOverlay;
  panel(which);
  if (overlay.matches) {
    state.panelTrigger = trigger;
    focus.focus();
  }
}

function closePanel() {
  panel();
  state.panelTrigger?.focus();
  state.panelTrigger = null;
}

function mark() {
  const logo = document.createElement('span');
  logo.className = 'brand-mark';
  logo.setAttribute('aria-hidden', 'true');
  logo.append(...Array.from({ length: 4 }, () => document.createElement('i')));
  return logo;
}

function updateHistory() {
  const links = [...state.chats].filter(chat => chat.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).map(chat => {
    const button = document.createElement('button');
    const icon = document.createElement('i');
    const title = document.createElement('span');
    icon.className = 'icon bubble';
    title.textContent = chat.title;
    button.append(icon, title);
    button.title = chat.title;
    button.setAttribute('aria-current', String(chat.id === state.chat?.id));
    button.addEventListener('click', () => {
      if (state.sending) return;
      state.chat = chat;
      input.value = '';
      closePanel();
      render();
      saveSelection();
    });
    return button;
  });
  $('history').replaceChildren(...links);
}

function updateMessages() {
  const messages = state.chat?.messages || [];
  $('welcome').hidden = messages.length > 0;
  $('messages').hidden = !messages.length;
  $('messages').replaceChildren(...messages.map(message => {
    const row = document.createElement('article');
    row.className = 'message ' + message.role;
    const body = document.createElement('div');
    body.className = 'message-body';
    if (message.role === 'assistant') {
      row.append(mark());
      const heading = document.createElement('div');
      heading.className = 'message-heading';
      heading.textContent = message.model;
      body.append(heading);
    } else {
      row.setAttribute('aria-label', 'You');
    }
    body.append(document.createTextNode(message.text));
    if (message.detail) {
      const detail = document.createElement('small');
      detail.textContent = message.detail;
      body.append(detail);
    }
    row.append(body);
    return row;
  }));
  const scroll = $('chat-scroll');
  scroll.scrollTop = messages.length ? scroll.scrollHeight : 0;
}

function updateProfile() {
  const profile = activeProfile();
  if (!profile) return;
  modelSelect.replaceChildren(...state.profiles.map(item => option(item.name, item.id)));
  modelSelect.value = profile.id;
  $('profile-name').textContent = profile.name;
  $('profile-name').title = profile.name;
  $('parameter-count').textContent = format.format(parameters(profile.model.width));
  $('parameter-count').title = profile.model.width + ' hidden neurons';
  $('seen-count').textContent = format.format(profile.model.rows);
  const status = $('model-status');
  status.hidden = false;
  status.textContent = profile.model.updates ? 'Trained' : 'Untrained';
  status.classList.toggle('ready', Boolean(profile.model.updates));
  updateTraining();
}

function updateTraining() {
  const enabled = Boolean(activeProfile());
  const busy = Boolean(state.job);
  modelSelect.disabled = !enabled || busy || state.sending;
  $('new-model').disabled = !enabled || busy || state.sending;
  $('new-chat').disabled = !enabled || state.sending;
  $('load-starter').disabled = !enabled || busy || state.loadingPack;
  $('starter-card').disabled = !enabled || busy || state.loadingPack;
  $('upload-card').disabled = !enabled || busy;
  dropzone.disabled = !enabled || busy;
  $('remove-file').disabled = busy;
  $('epochs').disabled = busy;
  $('rate').disabled = busy;
  dropzone.hidden = Boolean(state.dataset);
  $('selected-file').hidden = !state.dataset;
  trainButton.disabled = busy ? state.job.saving : !enabled || !state.dataset || state.loadingPack;
  trainButton.classList.toggle('stop', busy && !state.job.saving);
  trainButton.querySelector('span').textContent = busy ? (state.job.saving ? 'Saving checkpoint…' : 'Stop training') : 'Start training';
  if (state.dataset) {
    $('file-name').textContent = state.dataset.name;
    $('file-name').title = state.dataset.name;
    $('file-size').textContent = formatBytes(state.dataset.size);
  }
}

function updateComposer() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 145) + 'px';
  $('send').disabled = input.disabled || state.sending || !input.value.trim();
  const neural = modeSelect.value === 'neural';
  $('mode-icon').className = 'icon ' + (neural ? 'bolt' : 'book');
  $('mode-help').textContent = neural ? 'Generates text with your trained neural weights. Verify its answers.' : 'Finds relevant answers in your training data.';
}

function render() {
  updateHistory();
  updateMessages();
  updateProfile();
  updateComposer();
}

function freshChat(profileId) {
  return { id: crypto.randomUUID(), profileId, title: 'New chat', updatedAt: Date.now(), messages: [] };
}

function saveSelection() {
  const settings = { id: 'active', chatId: state.chat?.id, profileId: activeProfile()?.id, mode: modeSelect.value };
  save('settings', settings).catch(saveError);
}

async function boot() {
  try {
    const [profiles, chats, settings] = await Promise.all([read('profiles'), read('chats'), read('settings')]);
    const saved = settings.find(item => item.id === 'active');
    state.profiles = profiles.sort((a, b) => a.createdAt - b.createdAt);
    state.chats = chats;
    if (!profiles.length) {
      const profile = { id: crypto.randomUUID(), name: 'Starter model', model: makeModel(32), createdAt: Date.now(), revision: 0 };
      await save('profiles', profile);
      profiles.push(profile);
    }
    state.chat = chats.find(chat => chat.id === saved?.chatId) || freshChat(saved?.profileId || profiles[0].id);
    if (saved?.mode === 'neural') modeSelect.value = 'neural';
    input.disabled = false;
    render();
  } catch (error) {
    saveError(error);
  }
}

$('new-chat').addEventListener('click', () => {
  state.chat = freshChat(activeProfile().id);
  input.value = '';
  closePanel();
  render();
  saveSelection();
  input.focus();
});

modelSelect.addEventListener('change', async () => {
  const chat = { ...state.chat, profileId: modelSelect.value };
  state.chat = chat;
  if (chat.messages.length) {
    state.chats = state.chats.map(item => item.id === chat.id ? chat : item);
    save('chats', chat).catch(saveError);
  }
  saveSelection();
  say();
  updateProfile();
});

const widthSelect = $('width');
widthSelect.replaceChildren(...WIDTHS.map(width => option(width + ' neurons', width)));
const updateCapacity = () => { $('dialog-parameters').textContent = format.format(parameters(Number(widthSelect.value))); };
widthSelect.addEventListener('change', updateCapacity);
$('new-model').addEventListener('click', () => {
  $('model-form').reset();
  widthSelect.value = String(activeProfile().model.width);
  updateCapacity();
  $('model-dialog').showModal();
});

$('model-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('model-name').value.trim();
  if (!name) {
    $('model-name').focus();
    return;
  }
  const create = $('save-model');
  if (create.disabled) return;
  create.disabled = true;
  const profile = { id: crypto.randomUUID(), name, model: makeModel(Number(widthSelect.value)), createdAt: Date.now(), revision: 0 };
  try {
    await save('profiles', profile);
    state.profiles.push(profile);
    state.chat = freshChat(profile.id);
    input.value = '';
    $('model-dialog').close();
    saveSelection();
    say();
    render();
  } catch (error) {
    $('model-dialog').close();
    saveError(error);
  } finally {
    create.disabled = false;
  }
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

$('toggle-workshop').addEventListener('click', () => selectPanel('workshop', $('toggle-workshop'), $('close-workshop')));
$('toggle-sidebar').addEventListener('click', () => selectPanel('sidebar', $('toggle-sidebar'), $('new-chat')));
$('close-workshop').addEventListener('click', closePanel);
$('scrim').addEventListener('click', closePanel);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('scrim').hidden && !document.querySelector('dialog[open]')) closePanel();
});
workOverlay.addEventListener('change', () => panel());
chatOverlay.addEventListener('change', () => panel());
$('formats').addEventListener('click', () => $('formats-dialog').showModal());

function setDataset(file) {
  if (!file || state.job) return;
  if (!/\.zip$/i.test(file.name) || file.size < 22) {
    say('Choose a nonempty .zip archive.', true);
    return;
  }
  state.dataset = file;
  say();
  updateTraining();
}

function chooseFile() {
  if (!state.job && activeProfile()) fileInput.click();
}
dropzone.addEventListener('click', chooseFile);
$('upload-card').addEventListener('click', event => {
  selectPanel('workshop', event.currentTarget, dropzone);
  chooseFile();
});
fileInput.addEventListener('change', () => {
  setDataset(fileInput.files[0]);
  fileInput.value = '';
});
for (const eventName of ['dragover', 'drop']) {
  document.addEventListener(eventName, event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
}
dropzone.addEventListener('dragover', event => {
  if (!state.job && event.dataTransfer.types.includes('Files')) dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', event => {
  dropzone.classList.remove('dragging');
  setDataset(event.dataTransfer.files[0]);
});
$('remove-file').addEventListener('click', () => {
  state.dataset = null;
  say();
  updateTraining();
  dropzone.focus();
});

async function loadStarter() {
  if (state.job || state.loadingPack || !activeProfile()) return;
  state.loadingPack = true;
  say('Loading the algebra starter pack…');
  updateTraining();
  try {
    const response = await fetch('./assets/algebra-starter.zip');
    if (!response.ok) throw new Error('The starter pack could not load. Try again or upload a ZIP.');
    setDataset(new File([await response.blob()], 'algebra-starter.zip', { type: 'application/zip' }));
    say('Starter pack selected. Start training to learn from 1,212 examples.');
    trainButton.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    say(error.message, true);
  } finally {
    state.loadingPack = false;
    updateTraining();
  }
}

$('load-starter').addEventListener('click', loadStarter);
$('starter-card').addEventListener('click', event => {
  selectPanel('workshop', event.currentTarget, $('close-workshop'));
  loadStarter();
});

function finishJob(job) {
  job.worker.terminate();
  state.job = null;
  $('run').hidden = true;
  updateProfile();
}

trainButton.addEventListener('click', () => {
  if (state.job) {
    if (state.job.saving) return;
    finishJob(state.job);
    say('Training stopped. The previous checkpoint is ready to use.');
    return;
  }
  const profile = activeProfile();
  if (!profile || !state.dataset) return;
  let worker;
  try {
    worker = new Worker(new URL('./trainer.mjs', import.meta.url), { type: 'module' });
  } catch (error) {
    say(error.message, true);
    return;
  }
  const epochs = Number($('epochs').value);
  const rate = Number($('rate').value);
  const job = { worker, profile, saving: false };
  state.job = job;
  say();
  $('run').hidden = false;
  $('run-label').textContent = 'Reading ZIP…';
  $('run-percent').textContent = '0%';
  $('progress').value = 0;
  $('run-details').textContent = state.dataset.name;
  updateTraining();

  worker.onerror = event => {
    if (state.job !== job) return;
    finishJob(job);
    say(event.message || 'The training worker stopped unexpectedly.', true);
  };
  worker.onmessage = async ({ data }) => {
    if (state.job !== job) return;
    if (data.type === 'progress') {
      const fraction = Math.min(0.99, Math.max(0, data.percent));
      $('run-label').textContent = 'Epoch ' + data.epoch + ' of ' + epochs;
      $('run-percent').textContent = Math.round(fraction * 100) + '%';
      $('progress').value = fraction;
      $('run-details').textContent = format.format(data.records) + ' examples · ' + data.source;
      return;
    }
    if (data.type === 'error') {
      finishJob(job);
      say(data.message, true);
      return;
    }
    if (data.type !== 'complete') return;
    job.saving = true;
    updateTraining();
    $('run-label').textContent = 'Saving checkpoint…';
    $('run-percent').textContent = '100%';
    $('progress').value = 1;
    const revision = profile.revision ?? 0;
    const updated = { ...profile, model: data.model, revision: revision + 1 };
    try {
      await saveCheckpoint(updated, revision);
      state.profiles = state.profiles.map(item => item.id === profile.id ? updated : item);
      const skipped = data.skipped ? ' Skipped ' + format.format(data.skipped) + ' unsupported rows.' : '';
      say('Checkpoint saved. Added ' + format.format(data.records) + ' examples.' + skipped);
      if (state.dataset?.name === 'algebra-starter.zip' && !input.value) {
        input.value = 'What is slope?';
        updateComposer();
      }
      state.dataset = null;
    } catch (error) {
      saveError(error);
    } finally {
      finishJob(job);
    }
  };
  worker.postMessage({ file: state.dataset, model: profile.model, epochs, rate });
});

function reply(profile, prompt) {
  if (!profile.model.updates) return { text: 'This model is ready to train. Open Training Studio, load the algebra starter pack or upload a ZIP, and choose Start training.' };
  if (modeSelect.value === 'neural') {
    return { text: generate(profile.model, prompt) || 'The model needs more training data before it can generate a response.', detail: 'Generated by your experimental neural model' };
  }
  const example = matchExample(profile.model, prompt);
  if (!example) return { text: 'I couldn’t find a close example in this model’s data. Try a question from the training pack, or add worked examples on this topic.' };
  return { text: example.response, detail: [example.kind, example.source, example.kind === 'Related example' ? example.prompt : ''].filter(Boolean).join(' · ') };
}

$('composer').addEventListener('submit', async event => {
  event.preventDefault();
  const prompt = input.value.trim();
  const profile = activeProfile();
  if (!prompt || !profile || state.sending) return;
  state.sending = true;
  updateTraining();
  updateComposer();
  try {
    const answer = reply(profile, prompt);
    const original = state.chat;
    const messages = [...original.messages, { role: 'user', text: prompt }, { role: 'assistant', model: profile.name, ...answer }];
    const chat = { ...original, title: original.messages.length ? original.title : prompt.slice(0, 70), updatedAt: Date.now(), messages };
    await save('chats', chat);
    const existing = state.chats.some(item => item.id === chat.id);
    state.chats = existing ? state.chats.map(item => item.id === chat.id ? chat : item) : [...state.chats, chat];
    state.chat = chat;
    if (input.value.trim() === prompt) input.value = '';
    saveSelection();
    render();
  } catch (error) {
    saveError(error);
  } finally {
    state.sending = false;
    updateTraining();
    updateComposer();
  }
});

input.addEventListener('input', updateComposer);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
modeSelect.addEventListener('change', () => {
  updateComposer();
  if (state.chat) saveSelection();
});

let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install').hidden = true;
});
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install').hidden = true;
$('install').addEventListener('click', async () => {
  closePanel();
  if (!installPrompt) {
    $('install-dialog').showModal();
    return;
  }
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

boot();
