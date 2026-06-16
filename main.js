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

    const prompt = `You are an expert receipt scanner. Study this receipt image very carefully and read every single printed character.

Step 1 — Read the receipt top to bottom and identify:
- The date (convert DD-MM-YYYY or MM/DD/YYYY to YYYY-MM-DD)
- Every individual line item with its exact name and price
- The final total amount

Step 2 — Output ONLY this JSON (no markdown, no backticks, no explanation):
{"merchant":"","date":"YYYY-MM-DD","items":[{"name":"","amount":0.00}],"total":0.00}

CRITICAL number-reading rules:
- Read EVERY digit carefully: 48.00 is NOT 8.00 or 8.5, distinguish 1/7, 0/8, 3/8, 4/9
- amounts must be exact decimals with two decimal places (6.50 not 6.5)
- Include ALL line items — a typical receipt has 5-15 items, list every one
- total = the grand total line (e.g. "Total 84.80" → 84.80), NOT subtotal
- Skip only: tax, vat, subtotal, balance, change, card/cash payment lines
- Keep item names short and exact as printed`;


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
