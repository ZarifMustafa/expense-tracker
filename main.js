const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function getDataPath() {
  return path.join(app.getPath('userData'), 'expense-tracker-data.json');
}

function readData() {
  const filePath = getDataPath();
  if (!fs.existsSync(filePath)) {
    const d = { budgetItems: [], expenses: [], wishItems: [], settings: {} };
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
    return d;
  }
  try {
    const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!d.settings) d.settings = {};
    return d;
  } catch {
    return { budgetItems: [], expenses: [], wishItems: [], settings: {} };
  }
}

function writeData(data) {
  fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Expense Tracker',
    backgroundColor: '#f8fafc',
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Allow microphone access for voice expense entry
  mainWindow.webContents.session.setPermissionRequestHandler((_, permission, callback) => {
    callback(permission === 'media');
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-data', () => readData());
ipcMain.handle('save-data', (_, data) => {
  try { writeData(data); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('gen-id', () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
);
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Receipt Image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'svg'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

function svgToPng(svgPath) {
  return new Promise((resolve, reject) => {
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    const widthMatch = svgContent.match(/viewBox=["'][^"']*["']/);
    let w = 400, h = 600;
    if (widthMatch) {
      const parts = widthMatch[0].match(/[\d.]+/g);
      if (parts && parts.length >= 4) { w = Math.ceil(parseFloat(parts[2])); h = Math.ceil(parseFloat(parts[3])); }
    }
    const win = new BrowserWindow({ show: false, width: w, height: h, webPreferences: { offscreen: true } });
    const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}body{background:#f9f9f7}</style></head>
<body>${svgContent}</body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.webContents.on('did-finish-load', async () => {
      try {
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
        win.close();
        resolve(img.toPNG());
      } catch (e) { win.close(); reject(e); }
    });
    win.webContents.on('did-fail-load', (_, code, desc) => { win.close(); reject(new Error(desc)); });
  });
}
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// Transcribe audio using Groq Whisper (free)
ipcMain.handle('transcribe-voice', async (_, { audioData, apiKey }) => {
  try {
    const { net } = require('electron');
    const audioBuffer = Buffer.from(audioData);
    const boundary = 'VoiceBoundary' + Date.now().toString(36);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n--${boundary}--\r\n`)
    ]);
    const res = await net.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, error: 'INVALID_KEY' };
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    const transcript = (data.text || '').trim();
    if (!transcript) return { ok: false, error: 'No speech detected in the recording.' };
    return { ok: true, transcript };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Match expense items to budget categories using Groq
ipcMain.handle('match-categories', async (_, { items, categories, apiKey }) => {
  try {
    if (!categories.length || !apiKey) return { ok: true, matches: items.map(() => null) };
    const { net } = require('electron');
    const catList = categories.map((c, i) => `${i}: ${c.name}`).join('\n');
    const itemList = items.map((item, i) => `${i}: ${item.name}`).join('\n');
    const res = await net.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Match each expense item to the most relevant budget category index. Return ONLY a JSON array — one entry per expense item — with the category index (number) or null if none fits well.

Budget categories:
${catList}

Expense items to match:
${itemList}

Return format example for 3 items: [0, null, 2]
Return ONLY the JSON array, no explanation.`
        }],
        temperature: 0,
        max_tokens: 256
      })
    });
    if (!res.ok) return { ok: true, matches: items.map(() => null) };
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const arrMatch = text.match(/\[[\s\S]*?\]/);
    if (!arrMatch) return { ok: true, matches: items.map(() => null) };
    const indices = JSON.parse(arrMatch[0]);
    const matches = indices.map(idx => (idx != null && categories[idx]) ? categories[idx].id : null);
    return { ok: true, matches };
  } catch {
    return { ok: true, matches: items.map(() => null) };
  }
});

// Parse voice transcript into expenses using Groq
ipcMain.handle('parse-voice', async (_, { transcript, apiKey }) => {
  try {
    const { net } = require('electron');
    const res = await net.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Extract expense items from this spoken text and return ONLY a JSON object — no markdown, no explanation:
{"date":"YYYY-MM-DD or empty string if no date mentioned","items":[{"name":"expense description","amount":0.00}]}

Rules:
- Extract every expense or purchase mentioned
- amount is a plain decimal number (0 if not mentioned)
- If a date like "yesterday", "today", "Monday" is mentioned convert it relative to today (${new Date().toISOString().slice(0,10)})
- If no date mentioned, use empty string
- Keep names short and clear

Spoken text: "${transcript.replace(/"/g, "'")}"`
        }],
        temperature: 0.1,
        max_tokens: 512
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, error: 'INVALID_KEY' };
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not extract expenses from what you said. Please try again.');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.items?.length) throw new Error('No expenses found in what you said.');
    return { ok: true, data: { ...parsed, merchant: '', total: parsed.items.reduce((s, i) => s + (i.amount || 0), 0) } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Scan receipt using Groq API (free, no credit card — llama-3.2-11b-vision)
ipcMain.handle('scan-receipt', async (_, { imagePath, apiKey }) => {
  try {
    const { net } = require('electron');
    const ext = imagePath.split('.').pop().toLowerCase();
    const imageBuffer = ext === 'svg' ? await svgToPng(imagePath) : fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = ext === 'webp' ? 'image/webp' : 'image/png';

    const prompt = `Look at this receipt image and extract every line item.

Return ONLY a raw JSON object — no markdown, no backticks, no explanation:
{"merchant":"store name or empty string","date":"YYYY-MM-DD or empty string","items":[{"name":"item name","amount":0.00}],"total":0.00}

Rules:
- List EVERY individual product/item line separately with its exact printed name and price
- amounts are plain decimals (e.g. 48.00, 6.50)
- total = the grand total on the receipt
- Exclude: tax, vat, subtotal, balance, change, payment method lines
- date format: YYYY-MM-DD (e.g. 01-01-2018 becomes "2018-01-01")`;

    const res = await net.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: prompt }
          ]
        }],
        temperature: 0.1,
        max_tokens: 1024
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, error: 'INVALID_KEY' };
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse receipt data. Please try again.');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.items?.length) throw new Error('No items could be extracted from this receipt.');
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
