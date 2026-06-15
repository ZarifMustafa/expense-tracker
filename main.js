const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function getDataPath() {
  return path.join(app.getPath('userData'), 'expense-tracker-data.json');
}

function readData() {
  const filePath = getDataPath();
  if (!fs.existsSync(filePath)) {
    const defaultData = { budgetItems: [], expenses: [], wishItems: [], settings: {} };
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
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
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

ipcMain.handle('scan-receipt', async (_, { imagePath }) => {
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(imagePath);
    await worker.terminate();

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('No text found in image');

    // Price pattern: a number like 150, 1,500, 150.00, 1500.00 at end of line
    const priceRe = /([\d,]+\.?\d{0,2})\s*$/;
    const skipRe = /\b(total|subtotal|sub-total|tax|vat|change|cash|card|payment|balance|discount|thank|receipt|invoice|bill|tel|phone|fax|www\.|http|address|date|time|order|table|server|cashier|welcome|visit|please|come again)\b/i;
    const totalRe = /\b(grand\s*total|total|amount\s*due|net\s*total)\b/i;

    let merchant = null;
    let receiptDate = null;
    let total = null;
    const items = [];

    // Merchant: first line that looks like a name (no digits, not a price line)
    for (const line of lines.slice(0, 5)) {
      if (!priceRe.test(line) && !/^\d/.test(line) && line.length > 2) {
        merchant = line; break;
      }
    }

    // Date: look for common date patterns
    const datePatterns = [
      /(\d{4}[-/]\d{2}[-/]\d{2})/,
      /(\d{2}[-/]\d{2}[-/]\d{4})/,
      /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})/i
    ];
    for (const line of lines) {
      for (const dp of datePatterns) {
        const m = line.match(dp);
        if (m) {
          const raw = m[1];
          // Try to normalise to YYYY-MM-DD
          const d = new Date(raw.replace(/(\d{2})[-/](\d{2})[-/](\d{4})/, '$3-$2-$1'));
          if (!isNaN(d)) { receiptDate = d.toISOString().slice(0, 10); break; }
          receiptDate = raw; break;
        }
      }
      if (receiptDate) break;
    }

    // Extract line items and total
    for (const line of lines) {
      const priceMatch = line.match(priceRe);
      if (!priceMatch) continue;

      const amountStr = priceMatch[1].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!amount || amount <= 0) continue;

      if (totalRe.test(line)) { total = amount; continue; }
      if (skipRe.test(line)) continue;

      // Name = everything before the price, cleaned up
      let name = line.slice(0, line.lastIndexOf(priceMatch[0])).trim();
      name = name.replace(/^[\d\s\-*.x]+/, '').replace(/\s{2,}/g, ' ').trim();
      if (!name || name.length < 2) name = 'Item';

      items.push({ name, amount });
    }

    // If nothing extracted but we found a total, create one item
    if (!items.length && total) {
      items.push({ name: merchant ? `${merchant} purchase` : 'Receipt total', amount: total });
    }

    if (!items.length) throw new Error('Could not extract any items from this receipt. Try a clearer photo with better lighting.');

    return { ok: true, data: { merchant, date: receiptDate, items, total } };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});
