export const VOCABULARY = 2048;
const FEATURES = 256;
const MAX_TOKENS = 128;
export const WIDTHS = [16, 32, 48, 64, 96, 128];
export const parameters = width => (VOCABULARY * 2 + FEATURES) * width + VOCABULARY;

export function makeModel(width) {
  if (!WIDTHS.includes(width)) throw new Error('Unsupported model width.');
  const model = {
    width, rows: 0, updates: 0, seed: 193057, examples: [],
    words: ['', '', ''],
    input: new Float32Array(VOCABULARY * width),
    prompts: new Float32Array(FEATURES * width),
    output: new Float32Array(VOCABULARY * width),
    bias: new Float32Array(VOCABULARY)
  };
  for (const weights of [model.input, model.prompts, model.output]) {
    for (let i = 0; i < weights.length; i++) weights[i] = (random(model) - 0.5) * 0.25;
  }
  return model;
}

function random(state) {
  let seed = state.seed;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  state.seed = seed >>> 0;
  return state.seed / 4294967296;
}

function tokens(text) {
  return text.match(/[\p{L}\p{M}]+|\d+|[^\s]/gu) || [];
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

const common = new Set('a an and are as at be can do does for how i in is it me of on or that the this to what when where which with you your please tell explain show about work through help'.split(' '));

function terms(text) {
  const words = tokens(text.toLowerCase().replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3'));
  const hasMath = /[=+^*/]|\d/.test(text);
  return words.filter(word => !common.has(word) && (/^[\p{L}\d]/u.test(word) || (hasMath && '=+-^*/'.includes(word))));
}

const normalized = text => text.toLowerCase().replace(/[−–]/g, '-')
  .replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
const numbers = text => text.replace(/[−–]/g, '-').match(/-?\d+(?:\.\d+)?/g)?.join(' ') || '';

function promptFeatures(prompt) {
  const words = [...new Set(terms(prompt))].slice(0, 14);
  return words.length ? [...new Set(words.map(word => 1 + hash(word) % (FEATURES - 1)))] : [0];
}

function context(model, ids, position, features, hidden) {
  hidden.fill(0);
  const { width, input, prompts } = model;
  const last = ids[position - 1] ?? 1;
  const previous = ids[position - 2] ?? 1;
  const promptWeight = 0.9 / features.length ** 0.5;
  for (let j = 0; j < width; j++) {
    hidden[j] = input[last * width + j] + 0.45 * input[previous * width + j];
  }
  for (const feature of features) {
    for (let j = 0; j < width; j++) hidden[j] += prompts[feature * width + j] * promptWeight;
  }
  for (let j = 0; j < width; j++) hidden[j] = Math.tanh(hidden[j]);
  return { last, previous, promptWeight };
}

function logit(model, id, hidden) {
  const offset = id * model.width;
  let value = model.bias[id];
  for (let j = 0; j < model.width; j++) value += hidden[j] * model.output[offset + j];
  return value;
}

export function trainer(model, rate) {
  const vocabulary = new Map(model.words.slice(3).map((word, i) => [word, i + 3]));
  const seen = new Set(model.examples.map(example => normalized(example.prompt || example.response)));
  const hidden = new Float32Array(model.width);
  const gradient = new Float32Array(model.width);

  function tokenId(word) {
    if (vocabulary.has(word)) return vocabulary.get(word);
    if (model.words.length >= VOCABULARY) return 2;
    const id = model.words.length;
    vocabulary.set(word, id);
    model.words.push(word);
    return id;
  }

  return function train({ prompt, response, source }, remember) {
    const features = promptFeatures(prompt);
    const ids = tokens(response).slice(0, MAX_TOKENS).map(tokenId);
    ids.push(0);
    const steps = Math.min(4, ids.length);
    const start = Math.floor(random(model) * ids.length);
    let loss = 0;
    let count = 0;
    for (let step = 0; step < steps; step++) {
      const position = (start + Math.floor(step * ids.length / steps)) % ids.length;
      const target = ids[position];
      if (target === 2) continue;
      const { last, previous, promptWeight } = context(model, ids, position, features, hidden);
      gradient.fill(0);
      const candidates = new Set([target]);
      const limit = Math.min(25, model.words.length - 2);
      while (candidates.size < limit) {
        const candidate = Math.floor(random(model) * model.words.length);
        if (candidate !== 1 && candidate !== 2) candidates.add(candidate);
      }
      let maximum = -Infinity;
      const scores = [];
      for (const candidate of candidates) {
        const score = logit(model, candidate, hidden);
        scores.push(score);
        maximum = Math.max(maximum, score);
      }
      const total = scores.reduce((sum, score) => sum + Math.exp(score - maximum), 0);
      loss += Math.log(total) + maximum - scores[0];
      let index = 0;
      for (const candidate of candidates) {
        const probability = Math.exp(scores[index++] - maximum) / total;
        const change = rate * (Number(candidate === target) - probability);
        const offset = candidate * model.width;
        for (let j = 0; j < model.width; j++) {
          gradient[j] += change * model.output[offset + j];
          model.output[offset + j] += change * hidden[j];
        }
        model.bias[candidate] += change;
      }
      for (let j = 0; j < model.width; j++) {
        const delta = gradient[j] * (1 - hidden[j] ** 2);
        model.input[last * model.width + j] += delta;
        model.input[previous * model.width + j] += delta * 0.45;
        for (const feature of features) model.prompts[feature * model.width + j] += delta * promptWeight;
      }
      model.updates++;
      count++;
    }
    if (remember) {
      model.rows++;
      const key = normalized(prompt || response);
      // Keep a bounded sample, with room for examples from later imports.
      if (key && !seen.has(key)) {
        const sample = model.examples.length < 2400 ? model.examples.length : Math.floor(random(model) * model.rows);
        if (sample < 2400) {
          const old = model.examples[sample];
          if (old) seen.delete(normalized(old.prompt || old.response));
          model.examples[sample] = { prompt: prompt.slice(0, 600), response: response.slice(0, 4000), source };
          seen.add(key);
        }
      }
    }
    return count ? loss / count : null;
  };
}

export function matchExample(model, question) {
  const key = normalized(question);
  const query = terms(question);
  const distinct = [...new Set(query)];
  if (!distinct.length) return null;
  const numeric = numbers(question);
  const equation = /[=^<>≤≥²³]|\d\s*[+*/-]/.test(question);
  const math = text => text.replace(/[−–]/g, '-').match(/\d+(?:\.\d+)?|[=+*/^<>≤≥²³-]/g)?.join(' ') || '';
  const queryMath = math(question);
  let highest = 0;
  let best = null;
  for (const example of model.examples) {
    if (example.prompt && normalized(example.prompt) === key) return { ...example, kind: 'Exact example' };
    const words = terms(example.prompt || example.response.slice(0, 1200));
    // Matching the math itself prevents returning a worked solution to a different equation.
    if (equation && (!example.prompt || math(example.prompt) !== queryMath)) continue;
    if (numeric && numbers(example.prompt || example.response.slice(0, 1200)) !== numeric) continue;
    const wordSet = new Set(words);
    const overlap = distinct.filter(word => wordSet.has(word)).length;
    const score = (overlap / distinct.length) * (0.75 + 0.25 * overlap / wordSet.size);
    if (score >= 0.68 && score > highest && (overlap >= 2 || distinct.length === 1)) {
      highest = score;
      best = example;
    }
  }
  return best ? { ...best, kind: best.prompt ? 'Related example' : 'Text excerpt' } : null;
}

export function generate(model, prompt) {
  if (!model.updates || model.words.length < 4) return '';
  const features = promptFeatures(prompt);
  const hidden = new Float32Array(model.width);
  const state = { seed: hash(prompt) || 1 };
  const ids = [];
  for (let i = 0; i < 86; i++) {
    context(model, ids, i, features, hidden);
    const top = [];
    const recent = new Map();
    for (const id of ids.slice(-12)) recent.set(id, (recent.get(id) || 0) + 1);
    for (let id = i > 5 ? 0 : 3; id < model.words.length; id++) {
      if (id === 1 || id === 2) continue;
      const score = logit(model, id, hidden) - (recent.get(id) || 0) * 0.55;
      if (top.length === 5 && score <= top[4].score) continue;
      top.push({ id, score });
      top.sort((a, b) => b.score - a.score);
      if (top.length > 5) top.pop();
    }
    const weights = top.map(value => Math.exp((value.score - top[0].score) / 0.65));
    let pick = random(state) * weights.reduce((sum, value) => sum + value, 0);
    const next = top.find((_, index) => (pick -= weights[index]) <= 0) || top[0];
    if (next.id === 0) break;
    ids.push(next.id);
  }
  return ids.map(id => model.words[id]).join(' ')
    .replace(/\s+([.,?!:;%\])])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/\s+'\s+/g, "'");
}
