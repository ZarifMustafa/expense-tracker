const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  genId: () => ipcRenderer.invoke('gen-id'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  scanReceipt: (imagePath) => ipcRenderer.invoke('scan-receipt', { imagePath })
});
