import { generate, loadModel } from './model.mjs?v=5';
import { get } from './storage.mjs';

self.onmessage = async ({ data: { id, prompt } }) => {
  try {
    const profile = await get('profiles', id);
    if (!profile?.model.updates) throw new Error('Train this model before generating a reply.');
    self.postMessage({ text: generate(await loadModel(profile.model, { forTraining: false }), prompt) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Could not load the model for generation.' });
  }
};
