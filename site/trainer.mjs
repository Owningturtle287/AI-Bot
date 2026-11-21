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

async function run({ file, model, epochs, rate, cursor }, post, { checkpoint, signal } = {}) {
  const { entries, expanded } = await readZip(file);
  const train = trainer(model, rate);
  let records = cursor?.records ?? 0;
  let skipped = cursor?.skipped ?? 0;
  let loss = cursor?.loss ?? null;
  let lastReport = 0;
  let lastSave = performance.now();

  for (let epoch = cursor?.epoch ?? 1; epoch <= epochs; epoch++) {
    const resumingEpoch = cursor?.epoch === epoch;
    let usable = resumingEpoch ? cursor.usable : 0;
    const firstEntry = resumingEpoch ? cursor.entry : 0;
    let previous = expanded * (epoch - 1);
    for (let i = 0; i < firstEntry; i++) previous += entries[i].length;
    for (let index = firstEntry; index < entries.length; index++) {
      const entry = entries[index];
      const source = entry.name.split('/').at(-1).slice(0, 120);
      const jsonl = /\.jsonl$/i.test(source);
      const resumeLine = resumingEpoch && index === firstEntry ? cursor.line : 0;
      let paragraph = resumeLine ? cursor.paragraph : '';
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
        if (performance.now() - lastReport < 180) return;
        lastReport = performance.now();
        post({ type: 'progress', percent: (previous + bytes) / (expanded * epochs), epoch, records, skipped, loss, source });
      })) {
        lineNumber++;
        if (signal?.aborted) {
          if (checkpoint && lineNumber > resumeLine) await saveCursor(lineNumber - 1);
          return { type: 'paused' };
        }
        if (lineNumber <= resumeLine) continue;
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
        if (checkpoint && lineNumber % 512 === 0 && performance.now() - lastSave >= 12000) {
          await saveCursor(lineNumber);
        }
      }
      learnParagraph();
      previous += entry.length;

      async function saveCursor(line) {
        lastSave = performance.now();
        await checkpoint({ epoch, entry: index, line, paragraph, records, skipped, loss, usable }, model);
      }
    }
    if (!usable) throw new Error('No usable examples. Include prompt and response pairs or nonempty text.');
  }
  return { type: 'complete', model, records, skipped, loss };
}

export { run };
