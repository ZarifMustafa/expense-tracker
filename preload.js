const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  genId: () => ipcRenderer.invoke('gen-id'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scanReceipt: (args) => ipcRenderer.invoke('scan-receipt', args),
  transcribeVoice: (args) => ipcRenderer.invoke('transcribe-voice', args),
  matchCategories: (args) => ipcRenderer.invoke('match-categories', args),
  parseVoice: (args) => ipcRenderer.invoke('parse-voice', args),
  searchPrices: (args) => ipcRenderer.invoke('search-prices', args),
  getPriceWatch: () => ipcRenderer.invoke('get-price-watch'),
  checkPricesNow: () => ipcRenderer.invoke('check-prices-now'),
  priceSettingsChanged: () => ipcRenderer.invoke('price-settings-changed'),
  getStartup: () => ipcRenderer.invoke('get-startup'),
  setStartup: (enabled) => ipcRenderer.invoke('set-startup', enabled),
  onPriceWatchUpdated: (cb) => ipcRenderer.on('price-watch-updated', () => cb())
});
