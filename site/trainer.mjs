import { trainer } from './model.mjs';
import { lines, readZip } from './zip.mjs';

function conversation(row) {
  const pairs = [];
  let prompt = '';
  for (const message of row.messages) {
    if (!message || typeof message.content !== 'string') continue;
    if (message.role === 'user') prompt = message.content.trim();
    if (message.role === 'assistant' && prompt && message.content.trim()) {
      pairs.push({ prompt, response: message.content.trim() });
      prompt = '';
    }
  }
  return pairs;
}

function parse(line) {
  const row = JSON.parse(line);
  if (!row || typeof row !== 'object') return [];
  if (Array.isArray(row.messages)) return conversation(row);
  const prompt = row.prompt ?? row.question ?? row.instruction ?? '';
  const response = row.response ?? row.answer ?? row.output ?? row.completion ?? row.text;
  if (typeof prompt !== 'string' || typeof response !== 'string' || !response.trim()) return [];
  const input = typeof row.input === 'string' ? row.input.trim() : '';
  return [{ prompt: [prompt.trim(), input].filter(Boolean).join('\n'), response: response.trim() }];
}

async function run({ file, model, epochs, rate }, post) {
  const { entries, expanded } = await readZip(file);
  const train = trainer(model, rate);
  let previous = 0;
  let records = 0;
  let skipped = 0;
  let loss = null;
  let lastReport = 0;
  const completed = [];
  for (let epoch = 1; epoch <= epochs; epoch++) {
    let usable = 0;
    for (const entry of entries) {
      const source = entry.name.split('/').at(-1).slice(0, 120);
      const jsonl = /\.jsonl$/i.test(source);
      let paragraph = '';
      let lineNumber = 0;
      function learn(pair) {
        const next = train({ prompt: pair.prompt.slice(0, 4000), response: pair.response.slice(0, 12000), source }, epoch === 1);
        if (next !== null) loss = loss === null ? next : 0.98 * loss + 0.02 * next;
        usable++;
        if (epoch === 1) records++;
      }
      function learnParagraph() {
        if (paragraph) learn({ prompt: '', response: paragraph });
        paragraph = '';
      }
      for await (const line of lines(file, entry, bytes => {
        if (performance.now() - lastReport < 100) return;
        lastReport = performance.now();
        post({ type: 'progress', percent: (previous + bytes) / (expanded * epochs), epoch, records, skipped, loss, source });
      })) {
        lineNumber++;
        if (jsonl && line.trim()) {
          let pairs;
          try {
            pairs = parse(line);
          } catch {
            throw new Error(`${source}, line ${lineNumber}: invalid JSON. Use one object per line.`);
          }
          if (!pairs.length && epoch === 1) skipped++;
          for (const pair of pairs) learn(pair);
        } else if (!jsonl) {
          if (!line.trim()) learnParagraph();
          else {
            paragraph = paragraph ? paragraph + '\n' + line : line;
            while (paragraph.length > 2000) {
              const boundary = paragraph.lastIndexOf(' ', 2000);
              const end = boundary > 1500 ? boundary : 2000;
              learn({ prompt: '', response: paragraph.slice(0, end) });
              paragraph = paragraph.slice(end).trimStart();
            }
          }
        }
      }
      learnParagraph();
      previous += entry.length;
      if (epoch === 1) completed.push(source);
    }
    if (!usable) throw new Error('No usable examples. Include prompt and response pairs or nonempty text.');
  }
  return { type: 'complete', model, records, skipped, loss, files: completed.length };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    try {
      self.postMessage(await run(data, result => self.postMessage(result)));
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message || 'Training could not finish.' });
    }
  };
}

export { run };
