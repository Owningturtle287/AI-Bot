import { completeJob, failJob, firstJob, get, saveDraft, stopIfEmpty, updateJob } from './storage.mjs';
import { run } from './trainer.mjs';
import { loadModel, packModel } from './model.mjs?v=5';

export const QUEUE_KEY = 'training-queue';
let active;

export function pauseQueue() {
  active?.controller.abort();
}

async function download(job, signal) {
  let response;
  try {
    response = await fetch(job.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('This server did not allow the download. Use a direct public ZIP link or add the downloaded file.');
  }
  if (!response.ok) throw new Error('The ZIP download returned HTTP ' + response.status + '.');
  if (/text\/html/i.test(response.headers.get('content-type') || '')) {
    throw new Error('This link opens a web page. Add the ZIP file itself or use a direct download link.');
  }
  const blob = await response.blob();
  if (blob.size < 22) throw new Error('The download is empty or incomplete.');
  return blob;
}

async function processQueue(emit, signal) {
  while (!signal.aborted && (await get('settings', QUEUE_KEY))?.running) {
    const job = await firstJob();
    if (!job) {
      if (await stopIfEmpty()) return;
      continue;
    }
    let stage = 'Preparing';
    try {
      const profile = await get('profiles', job.profileId);
      if (!profile) throw new Error('This ZIP’s model profile is missing.');
      let file = await get('archives', job.id);
      if (!file) {
        if (!job.url) throw new Error('The ZIP is unavailable. Remove it and add the file again.');
        stage = 'Downloading';
        if (!await updateJob(job.id, { stage, error: null })) continue;
        await emit({ type: 'queue:changed' });
        file = await download(job, signal);
        if (!await updateJob(job.id, { size: file.size, stage: 'Preparing' }, file)) continue;
      }
      if (signal.aborted || !(await get('settings', QUEUE_KEY))?.running) return;
      const saved = await get('drafts', job.id);
      const revision = profile.revision ?? 0;
      const draft = saved?.revision === revision ? saved : null;
      const model = await loadModel(draft?.model ?? profile.model);
      stage = draft ? 'Resuming' : 'Training';
      if (!await updateJob(job.id, { stage, error: null })) continue;
      await emit({ type: 'queue:changed' });
      const output = await run({
        file, epochs: job.epochs, rate: job.rate, model, cursor: draft?.cursor
      }, progress => emit({ ...progress, type: 'queue:progress', id: job.id }), {
        signal,
        checkpoint: (cursor, model) => saveDraft(job.id, { revision, cursor, model: packModel(model) })
      });
      if (output.type === 'paused') return;
      await completeJob(job, { ...profile, model: packModel(output.model) }, {
        id: job.id, name: job.name, profileId: profile.id, records: output.records, skipped: output.skipped, starter: job.starter
      });
    } catch (error) {
      if (signal.aborted) return;
      const detail = error.name === 'QuotaExceededError'
        ? 'The browser rejected the checkpoint for lack of storage. ' + error.message
        : error.message || stage + ' failed.';
      await failJob(job.id, detail);
      return;
    }
    await emit({ type: 'queue:changed', refreshProfiles: true });
  }
}

export function wakeQueue(emit) {
  if (active) return active.promise;
  const controller = new AbortController();
  const process = lock => lock && processQueue(emit, controller.signal);
  const task = globalThis.navigator?.locks
    ? navigator.locks.request('neural-workshop-training', { ifAvailable: true }, process)
    : process(true);
  const promise = Promise.resolve(task).catch(error => emit({
    type: 'queue:error', message: error.message || 'The queue could not run.'
  })).finally(async () => {
    active = null;
    await emit({ type: 'queue:changed', refreshProfiles: true });
  });
  active = { controller, promise };
  return promise;
}
