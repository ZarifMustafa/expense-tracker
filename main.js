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

// Check if Ollama is running and return available models
ipcMain.handle('check-ollama', async () => {
  try {
    const { net } = require('electron');
    const res = await net.fetch('http://localhost:11434/api/tags');
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { running: true, models };
  } catch (e) {
    return { running: false, models: [], error: e.message };
  }
});

// Scan receipt using Ollama vision model
ipcMain.handle('scan-receipt', async (_, { imagePath, model }) => {
  try {
    const { net } = require('electron');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');

    const prompt = `Look at this receipt image carefully. Read every single line item printed on it.

Return ONLY a raw JSON object with no markdown, no explanation, no code fences — just the JSON:
{"merchant":"store name or empty string","date":"YYYY-MM-DD or empty string","items":[{"name":"exact item name from receipt","amount":0.00}],"total":0.00}

STRICT RULES:
1. List EVERY individual product/item line separately — do not merge or skip any
2. Copy the item name exactly as printed (e.g. "Lorem", "Ipsum", "Dolor Sit", "Amet")
3. amount must be a plain decimal number matching the price on that line
4. total = the grand total printed on the receipt (e.g. 84.80)
5. DO NOT include tax, vat, subtotal, balance, change, or payment method lines in items[]
6. date format must be YYYY-MM-DD (e.g. "2018-01-01" for 01-01-2018)
7. Output nothing except the JSON — no "Here is", no backticks, no extra text`;

    const res = await net.fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [base64],
        stream: false,
        options: { temperature: 0.1, num_predict: 1024 }
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      if (txt.toLowerCase().includes('not found') || txt.toLowerCase().includes('pull')) {
        return { ok: false, error: 'MODEL_NOT_FOUND', model };
      }
      throw new Error(txt);
    }

    const data = await res.json();
    const text = (data.response || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return valid JSON. Try again or use a different model.');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.items?.length) throw new Error('No items could be extracted from this receipt.');
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
