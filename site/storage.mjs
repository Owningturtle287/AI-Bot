const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('neural-workshop', 2);
  request.onupgradeneeded = ({ oldVersion }) => {
    const db = request.result;
    if (oldVersion < 1) {
      for (const name of ['profiles', 'chats', 'settings']) db.createObjectStore(name, { keyPath: 'id' });
    }
    if (oldVersion < 2) {
      db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('archives');
      db.createObjectStore('drafts');
    }
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Close other Neural Workshop tabs and reopen this one to finish updating storage.'));
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
});

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function use(stores, mode, operation) {
  const db = await database;
  const transaction = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('The save was interrupted.'));
  });
  try {
    const value = await Promise.all([Promise.resolve().then(() => operation(name => transaction.objectStore(name))), done]);
    return value[0];
  } catch (error) {
    try { transaction.abort(); } catch { /* Already closed. */ }
    throw error;
  }
}

export const read = name => use([name], 'readonly', store => result(store(name).getAll()));
export const get = (name, id) => use([name], 'readonly', store => result(store(name).get(id)));
export const save = (name, record, key) => use([name], 'readwrite', store => result(
  key === undefined ? store(name).put(record) : store(name).put(record, key)
));

export async function enqueue(job, archive) {
  return use(['queue', 'archives'], 'readwrite', async store => {
    const id = await result(store('queue').add(job));
    if (archive) store('archives').put(archive, id);
    return id;
  });
}

export const firstJob = () => use(['queue'], 'readonly', async store => {
  const cursor = await result(store('queue').openCursor());
  return cursor?.value;
});

export async function removeJob(id) {
  return use(['queue', 'archives', 'drafts', 'settings'], 'readwrite', async store => {
    const [head, control] = await Promise.all([
      result(store('queue').openCursor()),
      result(store('settings').get('training-queue'))
    ]);
    if (head?.key === id && control?.running) throw new Error('Pause the queue before removing its first ZIP.');
    for (const name of ['queue', 'archives', 'drafts']) store(name).delete(id);
  });
}

export async function setQueue(patch) {
  return use(['settings'], 'readwrite', async store => {
    const control = await result(store('settings').get('training-queue'));
    store('settings').put({ ...control, ...patch, id: 'training-queue' });
  });
}

export async function stopIfEmpty() {
  return use(['queue', 'settings'], 'readwrite', async store => {
    const head = await result(store('queue').openCursor());
    if (head) return false;
    const control = await result(store('settings').get('training-queue'));
    store('settings').put({ ...control, id: 'training-queue', running: false });
    return true;
  });
}

export async function saveDraft(id, draft) {
  return use(['queue', 'drafts'], 'readwrite', async store => {
    if (await result(store('queue').get(id))) store('drafts').put(draft, id);
  });
}

export async function completeJob(job, profile, summary) {
  return use(['queue', 'archives', 'drafts', 'profiles', 'settings'], 'readwrite', async store => {
    const [head, current, control] = await Promise.all([
      result(store('queue').openCursor()), result(store('profiles').get(profile.id)),
      result(store('settings').get('training-queue'))
    ]);
    if (head?.key !== job.id) return false;
    if (!current || (current.revision ?? 0) !== (profile.revision ?? 0)) {
      throw new Error('The model was updated in another tab. Resume the queue to use its latest checkpoint.');
    }
    store('profiles').put({ ...profile, revision: (profile.revision ?? 0) + 1 });
    for (const name of ['queue', 'archives', 'drafts']) store(name).delete(job.id);
    store('settings').put({ ...control, id: 'training-queue', last: summary });
    return true;
  });
}

export async function updateJob(id, patch, archive) {
  return use(['queue', 'archives'], 'readwrite', async store => {
    const job = await result(store('queue').get(id));
    if (!job) return false;
    store('queue').put({ ...job, ...patch });
    if (archive) store('archives').put(archive, id);
    return true;
  });
}

export async function failJob(id, message) {
  return use(['queue', 'settings'], 'readwrite', async store => {
    const head = await result(store('queue').openCursor());
    if (head?.key !== id) return;
    head.update({ ...head.value, stage: 'Failed', error: message });
    const control = await result(store('settings').get('training-queue'));
    store('settings').put({ ...control, id: 'training-queue', running: false });
  });
}
