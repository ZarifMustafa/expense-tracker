const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  genId: () => ipcRenderer.invoke('gen-id'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  scanReceipt: (args) => ipcRenderer.invoke('scan-receipt', args),
  parseVoice: (args) => ipcRenderer.invoke('parse-voice', args)
});
