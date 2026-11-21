# Neural Workshop

Neural Workshop is an installable chatbot and training studio that runs on the device that opens it. GitHub Actions builds the app and publishes it to [GitHub Pages](https://owningturtle287.github.io/AI-Bot/). Browser storage keeps chats, named model profiles, weights, and a bounded sample of training examples.

## Train a model

1. Open **New chat**. Under **Training Studio**, choose **New**, enter a profile name, and select a **Model size**. The dialog shows the exact parameter count and weight storage. Select a saved model from the chat header.
2. Select or drop multiple ZIPs at once. **ZIP links** accepts direct HTTPS links from servers that allow browser downloads. **Algebra pack** adds 1,212 worked Algebra I and II examples. Each ZIP is assigned to the selected model and training settings when added.
3. Choose **Start queue**. Neural Workshop downloads and trains the ZIPs one at a time, in the order they were added. Each completed ZIP saves to its model profile and releases its archive storage. If a ZIP fails, retry it or remove it to continue. The number of queued ZIPs depends on available browser storage.
4. In **Example answers** mode, ask “What is slope?” or “How do I factor a quadratic?” The chat shows the matching answer and its source file. Switch to **Neural generation** to sample text from the trained weights. The small model starts with random weights and may produce incorrect or incoherent text.

Use **Install app** or your browser’s **Install app** or **Add to Home Screen** action. Open the page online first so the app and starter pack can be cached. Chats and weights are specific to the browser profile and device. Clearing site data clears both.

The service worker runs the queue when the browser allows background work. Phones and browsers can suspend or stop it after locking the screen, closing the app, or running low on resources. The queue and periodic training checkpoints survive this interruption. If training was running, reopening or returning to the app picks up from the latest saved progress. **Pause queue** stops it until you choose **Resume queue**. Long downloads may restart if interrupted.

The **Light mode** toggle is in the chat sidebar. The app remembers your choice on this device.

## Prepare datasets

Use an unencrypted ZIP with UTF-8 files. Store one JSON object per line in a `*.jsonl` file.

```json
{"prompt":"What is slope?","response":"Slope is the change in y divided by the change in x."}
{"prompt":"Solve for x: 3x + 5 = 20.","response":"Subtract 5 to get 3x = 15. Divide by 3 to get x = 5."}
```

Question/answer, instruction/input/output and user/assistant messages are also supported. Each assistant turn trains against its preceding user message. Text and Markdown train on paragraphs and can be found as excerpts. Convert PDFs, spreadsheets and other binary formats into clean text or prompt/response pairs first. Keep worked answers correct, include varied phrasings, and reserve separate questions to check what the model learned.

ZIP and ZIP64 archives stream through a worker using stored or Deflate compression. Limits per archive include 24 GiB of expanded supported text, 50,000 entries, a 32 MiB ZIP directory, and individual lines up to roughly 1 MiB. Each example uses at most its first 128 response tokens for neural training. The model retains up to 2,400 examples for search. Browser memory, storage quotas, CPU and background behavior vary. Use smaller ZIPs for multi-gigabyte collections so the queue can save checkpoints and release storage between files.

Generate a reproducible synthetic algebra ZIP with:

```sh
python3 tools/algebra_pack.py algebra.zip --records 50000 --seed 47
```

Use different seeds for additional archives or separate evaluation examples. The generator computes answers from the sampled numbers, including linear equations, inequalities, systems, factoring, inverse functions, logarithms, sequences and exponential growth.

## Model and local development

The experimental prompt-conditioned language model trains token embeddings, prompt features, output weights and biases with a sampled next-token objective. Its presets range from 71,680 to 67,403,776 trainable parameters, with hidden widths of 16 to 1,024 and vocabulary capacities of 2,048 to 32,768 tokens. Changing capacity means creating a separate profile. The app allocates its weights when the first ZIP starts training.

The 67.4-million-parameter preset allocates about 257 MiB for its Float32 weights during training. Checkpoints store observed token rows and regenerate the untouched rows from the initialization seed. The largest presets are intended for desktops. Example answers use the saved example sample. Neural generation loads the observed rows in a worker. A 50-billion-parameter model would need 200 GB for Float32 weights alone and would require a separate compute backend.

```sh
python3 tools/icons.py site/assets
python3 tools/algebra_pack.py site/assets/algebra-starter.zip
python3 -m http.server 8000 --directory site
```

Open `http://localhost:8000` in a recent browser. The [deployment workflow](.github/workflows/pages.yml) publishes updates pushed to `main`. The repository's Pages source is **GitHub Actions**.
