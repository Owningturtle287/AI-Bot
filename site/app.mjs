import { matchExample, MODEL_SIZES, parameters, VOCABULARY, weightBytes } from './model.mjs';
import { enqueue, get, read, removeJob, save, setQueue } from './storage.mjs';

const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
const workerVersion = '?v=3';
const state = {
  profiles: [], chats: [], chat: null, jobs: [], running: false, adding: false,
  loadingPack: false, sending: false, queueRead: 0
};
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
  const { width, vocabulary } = profile.model;
  $('parameter-count').textContent = format.format(parameters(width, vocabulary));
  $('parameter-count').title = format.format(width) + ' hidden neurons · '
    + format.format(vocabulary ?? VOCABULARY) + ' vocabulary slots';
  $('seen-count').textContent = format.format(profile.model.rows);
  const status = $('model-status');
  status.hidden = false;
  status.textContent = profile.model.updates ? 'Trained' : 'Untrained';
  status.classList.toggle('ready', Boolean(profile.model.updates));
  updateTraining();
}

function updateTraining() {
  const enabled = Boolean(activeProfile());
  const adding = state.adding || state.loadingPack;
  modelSelect.disabled = !enabled || state.sending;
  $('new-model').disabled = !enabled || state.sending;
  $('new-chat').disabled = !enabled || state.sending;
  $('load-starter').disabled = !enabled || adding;
  $('starter-card').disabled = !enabled || adding;
  $('upload-card').disabled = !enabled || adding;
  $('add-links').disabled = !enabled || adding;
  dropzone.disabled = !enabled || adding;
  trainButton.disabled = state.settingQueue || !state.jobs.length || (!state.running && adding);
  trainButton.classList.toggle('stop', state.running);
  trainButton.querySelector('span').textContent = state.running ? 'Pause queue'
    : state.jobs[0]?.stage === 'Failed' ? 'Retry queue'
    : state.jobs[0]?.stage ? 'Resume queue' : 'Start queue';
}

function renderQueue() {
  const { jobs, running } = state;
  $('queue-count').textContent = format.format(jobs.length) + (jobs.length === 1 ? ' file' : ' files');
  $('queue-empty').hidden = Boolean(jobs.length);
  const list = $('queue-list');
  list.hidden = !jobs.length;
  const top = list.scrollTop;
  const contents = document.createDocumentFragment();
  jobs.forEach((job, index) => {
    const row = document.createElement('li');
    row.className = 'selected-file';
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    const glyph = document.createElement('i');
    glyph.className = 'icon file-icon-shape';
    icon.append(glyph);
    const info = document.createElement('div');
    const name = document.createElement('strong');
    const details = document.createElement('small');
    name.textContent = job.name;
    name.title = job.name;
    const stage = job.stage === 'Failed' ? 'Failed'
      : index === 0 && job.stage ? (running ? job.stage : 'Paused') : 'Queued';
    const profile = state.profiles.find(item => item.id === job.profileId);
    details.textContent = [stage, job.size ? formatBytes(job.size) : 'Download', profile?.name].filter(Boolean).join(' · ');
    details.title = details.textContent;
    info.append(name, details);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button';
    remove.setAttribute('aria-label', 'Remove ' + job.name);
    const cross = document.createElement('i');
    cross.className = 'icon close';
    remove.append(cross);
    remove.disabled = index === 0 && running;
    remove.addEventListener('click', async () => {
      try {
        await removeJob(job.id);
        say();
        await refreshQueue();
      } catch (error) { say(error.message, true); }
    });
    row.append(icon, info, remove);
    contents.append(row);
  });
  list.replaceChildren(contents);
  list.scrollTop = top;
  const head = jobs[0];
  const stage = head?.stage;
  if (!head || !running || !stage) {
    $('run').hidden = true;
    state.progressJob = null;
  }
  else if (state.progressJob !== head.id || state.progressStage !== stage) {
    state.progressJob = head.id;
    state.progressStage = stage;
    $('run').hidden = false;
    $('run-label').textContent = stage + '…';
    $('run-percent').textContent = '';
    $('progress').removeAttribute('value');
    $('run-details').textContent = head.name;
  }
  if (head?.error) say(head.name + ' · ' + head.error, true);
  updateTraining();
}

async function refreshQueue(refreshProfiles = false) {
  const readNumber = ++state.queueRead;
  const [jobs, control, profiles] = await Promise.all([
    read('queue'), get('settings', 'training-queue'), refreshProfiles ? readProfiles() : null
  ]);
  if (profiles) {
    for (const profile of profiles) {
      const position = state.profiles.findIndex(item => item.id === profile.id);
      if (position < 0) state.profiles.push(profile);
      else if ((state.profiles[position].revision ?? 0) <= (profile.revision ?? 0)) state.profiles[position] = profile;
    }
    updateProfile();
  }
  if (readNumber !== state.queueRead) return;
  state.jobs = jobs;
  state.running = Boolean(control?.running);
  const last = control?.last;
  if (last && state.lastResult !== last.id) {
    state.lastResult = last.id;
    if (!jobs[0]?.error) {
      const skipped = last.skipped ? ' Skipped ' + format.format(last.skipped) + ' unsupported rows.' : '';
      say('Checkpoint saved. Added ' + format.format(last.records) + ' examples from ' + last.name + '.' + skipped);
    }
    if (last.starter && activeProfile()?.id === last.profileId && !input.value && !state.chat?.messages.length) {
      input.value = 'What is slope?';
      updateComposer();
    }
  }
  renderQueue();
}

function updateComposer() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 145) + 'px';
  $('send').disabled = input.disabled || state.sending || !input.value.trim();
  const neural = modeSelect.value === 'neural';
  $('mode-icon').className = 'icon ' + (neural ? 'bolt' : 'book');
  $('mode-help').textContent = state.sending ? 'Generating a reply…'
    : neural ? 'Generates text with your trained neural weights. Verify its answers.'
    : 'Finds relevant answers in your training data.';
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

async function readProfiles() {
  return (await read('profiles')).map(({ model, ...profile }) => {
    const { width, vocabulary, rows, updates } = model;
    return { ...profile, model: { width, vocabulary, rows, updates } };
  });
}

function newProfile(name, { width, vocabulary }) {
  return {
    id: crypto.randomUUID(), name, createdAt: Date.now(), revision: 0,
    model: { width, vocabulary, rows: 0, updates: 0 }
  };
}

async function boot() {
  try {
    const [profiles, chats, settings] = await Promise.all([readProfiles(), read('chats'), read('settings')]);
    const saved = settings.find(item => item.id === 'active');
    state.profiles = profiles.sort((a, b) => a.createdAt - b.createdAt);
    state.chats = chats;
    if (!profiles.length) {
      const profile = newProfile('Starter model', { width: 32, vocabulary: VOCABULARY });
      await save('profiles', profile);
      profiles.push(profile);
    }
    state.chat = chats.find(chat => chat.id === saved?.chatId) || freshChat(saved?.profileId || profiles[0].id);
    if (saved?.mode === 'neural') modeSelect.value = 'neural';
    input.disabled = false;
    render();
    await refreshQueue();
    wakeTraining();
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

const sizeSelect = $('model-size');
sizeSelect.replaceChildren(...MODEL_SIZES.map(({ width, vocabulary }, index) => {
  const desktop = weightBytes(width, vocabulary) >= 64 * 1024 ** 2;
  return option(compact.format(parameters(width, vocabulary)) + ' parameters' + (desktop ? ' · Desktop' : ''), index);
}));
function updateCapacity() {
  const { width, vocabulary } = MODEL_SIZES[Number(sizeSelect.value)];
  const bytes = weightBytes(width, vocabulary);
  $('dialog-parameters').textContent = format.format(parameters(width, vocabulary));
  $('dialog-weights').textContent = formatBytes(bytes);
  $('dialog-shape').textContent = format.format(width) + ' neurons · ' + format.format(vocabulary) + ' vocabulary slots';
  $('dialog-desktop').hidden = bytes < 64 * 1024 ** 2;
}
sizeSelect.addEventListener('change', updateCapacity);
$('new-model').addEventListener('click', () => {
  $('model-form').reset();
  const { width, vocabulary = VOCABULARY } = activeProfile().model;
  const current = MODEL_SIZES.findIndex(size => size.width === width && size.vocabulary === vocabulary);
  sizeSelect.value = String(Math.max(0, current));
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
  const profile = newProfile(name, MODEL_SIZES[Number(sizeSelect.value)]);
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

async function addItems(items, starter = false) {
  const profile = activeProfile();
  if (!profile || state.adding || !items.length) return;
  state.adding = true;
  updateTraining();
  const settings = { profileId: profile.id, epochs: Number($('epochs').value), rate: Number($('rate').value) };
  let added = 0;
  let invalid = 0;
  try {
    for (const { file, url, name } of items) {
      if (file && !await isZip(file)) {
        invalid++;
        continue;
      }
      say('Saving ZIP ' + (added + invalid + 1) + ' of ' + items.length + '…');
      await enqueue({ ...settings, url, name, size: file?.size, starter }, file);
      added++;
    }
    say(added ? format.format(added) + (added === 1 ? ' ZIP added to the queue.' : ' ZIPs added to the queue.')
      + (invalid ? ' Skipped ' + invalid + ' invalid files.' : '') : 'Choose nonempty .zip files.', !added);
  } catch (error) {
    const detail = error.name === 'QuotaExceededError' ? 'This device ran out of browser storage. Train or remove some queued ZIPs, then add the rest.' : error.message;
    say(added + ' of ' + items.length + ' ZIPs saved. ' + detail, true);
  } finally {
    state.adding = false;
    await refreshQueue().catch(saveError);
    updateTraining();
    wakeTraining();
  }
}

async function isZip(file) {
  if (file.size < 22) return false;
  if (/\.zip$/i.test(file.name)) return true;
  const signature = new DataView(await file.slice(0, 4).arrayBuffer());
  return signature.getUint32(0, true) === 0x04034b50;
}

function addFiles(files) {
  void addItems(Array.from(files, file => ({ file, name: file.name })));
}

function chooseFiles() {
  if (!dropzone.disabled) fileInput.click();
}
dropzone.addEventListener('click', chooseFiles);
$('upload-card').addEventListener('click', event => {
  selectPanel('workshop', event.currentTarget, dropzone);
  chooseFiles();
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});
for (const eventName of ['dragover', 'drop']) {
  document.addEventListener(eventName, event => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
}
dropzone.addEventListener('dragover', event => {
  if (!dropzone.disabled && event.dataTransfer.types.includes('Files')) dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', event => {
  dropzone.classList.remove('dragging');
  addFiles(event.dataTransfer.files);
});

const linksField = $('zip-links');
$('add-links').addEventListener('click', () => $('links-dialog').showModal());
linksField.addEventListener('input', () => linksField.setCustomValidity(''));
$('links-form').addEventListener('submit', event => {
  event.preventDefault();
  let items;
  try {
    items = linksField.value.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const url = new URL(line);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      const filename = url.pathname.split('/').pop();
      const name = /\.zip$/i.test(filename) ? filename : 'Download ' + (index + 1) + ' · ' + url.hostname;
      return { name, url: url.href };
    });
    if (!items.length) throw new Error();
  } catch {
    linksField.setCustomValidity('Enter one valid direct HTTPS link per line.');
    linksField.reportValidity();
    return;
  }
  $('links-dialog').close();
  linksField.value = '';
  void addItems(items);
});

async function loadStarter() {
  if (state.loadingPack || state.adding || !activeProfile()) return;
  state.loadingPack = true;
  say('Loading the algebra starter pack…');
  updateTraining();
  try {
    const response = await fetch('./assets/algebra-starter.zip');
    if (!response.ok) throw new Error('The starter pack could not load. Try again or upload a ZIP.');
    const file = new File([await response.blob()], 'algebra-starter.zip', { type: 'application/zip' });
    await addItems([{ file, name: file.name }], true);
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
  void loadStarter();
});

let registration;
let fallback;
const queueService = () => {
  const worker = registration?.active || navigator.serviceWorker?.controller;
  return worker && new URL(worker.scriptURL).search === workerVersion ? worker : null;
};

function receiveTraining({ data }) {
  if (data?.type === 'queue:changed') {
    void refreshQueue(data.refreshProfiles).catch(saveError);
  } else if (data?.type === 'queue:error') {
    say(data.message, true);
  } else if (data?.type === 'queue:progress' && state.running && state.jobs[0]?.id === data.id) {
    const fraction = Math.min(0.99, Math.max(0, data.percent));
    $('run').hidden = false;
    $('run-label').textContent = 'Epoch ' + data.epoch + ' of ' + state.jobs[0].epochs;
    $('run-percent').textContent = Math.round(fraction * 100) + '%';
    $('progress').value = fraction;
    $('run-details').textContent = format.format(data.records) + ' examples · ' + data.source;
  }
}

function wakeTraining() {
  if (!state.running) return;
  const service = queueService();
  try {
    if (service) service.postMessage('queue:wake');
    else {
      if (!fallback) {
        fallback = new Worker(new URL('./queue-worker.mjs', import.meta.url), { type: 'module' });
        fallback.onmessage = receiveTraining;
        fallback.onerror = event => say(event.message || 'The training worker stopped. Reopen the app to resume.', true);
      }
      fallback.postMessage('queue:wake');
    }
  } catch (error) { say(error.message, true); }
}

trainButton.addEventListener('click', async () => {
  if (state.settingQueue) return;
  state.settingQueue = true;
  const starting = !state.running;
  updateTraining();
  try {
    await setQueue({ running: starting });
    state.running = starting;
    if (starting) {
      say();
      wakeTraining();
    } else {
      queueService()?.postMessage('queue:pause');
      fallback?.postMessage('queue:pause');
      say('Queue paused. Resume to continue from saved progress.');
    }
    await refreshQueue();
  } catch (error) {
    saveError(error);
  } finally {
    state.settingQueue = false;
    updateTraining();
  }
});

function resumeVisible() {
  if (!activeProfile()) return;
  void refreshQueue(true).then(wakeTraining).catch(saveError);
}

navigator.serviceWorker?.addEventListener('message', receiveTraining);
navigator.serviceWorker?.addEventListener('controllerchange', resumeVisible);
if (navigator.serviceWorker) {
  navigator.serviceWorker.register('./sw.js' + workerVersion, { type: 'module' }).then(result => {
    registration = result;
    resumeVisible();
  }).catch(() => wakeTraining());
}
window.addEventListener('online', resumeVisible);
window.addEventListener('pageshow', resumeVisible);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resumeVisible();
  else if (state.running) {
    void registration?.sync?.register('training-queue').catch(() => {});
  }
});
setInterval(() => {
  if (!document.hidden && state.running) wakeTraining();
}, 9000);

async function reply(profile, prompt) {
  if (!profile.model.updates) return { text: 'This model is ready to train. Open Training Studio, load the algebra starter pack or upload a ZIP, and choose Start training.' };
  if (modeSelect.value === 'neural') {
    const worker = new Worker(new URL('./generation-worker.mjs', import.meta.url), { type: 'module' });
    try {
      const text = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.text);
        worker.onerror = event => reject(new Error(event.message || 'The generation worker stopped.'));
        worker.postMessage({ id: profile.id, prompt });
      });
      return { text: text || 'The model needs more training data before it can generate a response.', detail: 'Generated by your experimental neural model' };
    } finally {
      worker.terminate();
    }
  }
  const { model } = await get('profiles', profile.id);
  const example = matchExample(model, prompt);
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
    const answer = await reply(profile, prompt);
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
const themeToggle = $('theme-toggle');
function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = light ? '#f5f7fa' : '#15171c';
  themeToggle.setAttribute('aria-pressed', String(light));
  themeToggle.querySelector('.theme-icon').textContent = light ? '☾' : '☼';
}
applyTheme(document.documentElement.dataset.theme || 'dark');
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('workshop-theme', theme); } catch { /* Keep the current view usable. */ }
});

boot();
