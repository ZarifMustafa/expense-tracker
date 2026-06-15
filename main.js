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

ipcMain.handle('scan-receipt', async (_, { imagePath, apiKey }) => {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    const mediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg';

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          {
            type: 'text',
            text: `Analyze this receipt and extract expense information. Return ONLY a JSON object, no other text:
{
  "merchant": "store name or null",
  "date": "YYYY-MM-DD if visible or null",
  "items": [
    {"name": "item description", "amount": numeric_amount}
  ],
  "total": numeric_total_or_null
}
Rules: amounts are numbers only (no currency symbols), names are concise. If individual items aren't visible, return one item with the total.`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse receipt data from image');
    const data = JSON.parse(jsonMatch[0]);
    if (!data.items || !data.items.length) throw new Error('No items found in receipt');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
