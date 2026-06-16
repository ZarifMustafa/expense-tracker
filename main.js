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
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.openDevTools(); // remove after debugging
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
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// Helper: HTTP GET returning parsed JSON
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Helper: HTTP POST returning parsed JSON
function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 11434,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out after 120s')); });
    req.write(body);
    req.end();
  });
}

// Check if Ollama is running and return available models
ipcMain.handle('check-ollama', async () => {
  try {
    const res = await httpGet('http://localhost:11434/api/tags');
    const models = (res.data?.models || []).map(m => m.name);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
});

// Scan receipt using Ollama vision model
ipcMain.handle('scan-receipt', async (_, { imagePath, model }) => {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');

    const prompt = `You are analyzing a receipt image. Extract all purchased items and return ONLY a valid JSON object — no explanation, no markdown, just JSON:
{
  "merchant": "store name or null",
  "date": "YYYY-MM-DD if visible or null",
  "items": [
    {"name": "item description", "amount": 0.00}
  ],
  "total": 0.00
}
Rules:
- amounts are plain decimal numbers (no currency symbols)
- only include actual purchased line items
- exclude: tax, vat, subtotal, total, balance, change, payment, discount lines
- if individual items are unclear, create one entry with the grand total amount`;

    const res = await httpPost('http://localhost:11434/api/generate', {
      model,
      prompt,
      images: [base64],
      stream: false,
      options: { temperature: 0.1, num_predict: 512 }
    });

    if (!res.ok) {
      const txt = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (txt.toLowerCase().includes('not found') || txt.toLowerCase().includes('pull')) {
        return { ok: false, error: 'MODEL_NOT_FOUND', model };
      }
      throw new Error(txt);
    }

    const text = (res.data?.response || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return valid JSON. Try again or use a different model.');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.items?.length) throw new Error('No items could be extracted from this receipt.');
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
