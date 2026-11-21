const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('neural-workshop', 1);
  request.onupgradeneeded = () => {
    for (const store of ['profiles', 'chats', 'settings']) request.result.createObjectStore(store, { keyPath: 'id' });
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(request.result);
});

export async function read(store) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function save(store, record) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('The save was interrupted.'));
  });
}

export async function saveCheckpoint(profile, expectedRevision) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('profiles', 'readwrite');
    const store = transaction.objectStore('profiles');
    const request = store.get(profile.id);
    let problem;
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== expectedRevision) {
        problem = new Error('Another tab updated this model. Reload the app and start again from the latest checkpoint.');
        transaction.abort();
        return;
      }
      store.put(profile);
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(problem || transaction.error || new Error('The checkpoint save was interrupted.'));
    transaction.onerror = () => reject(transaction.error);
  });
}
