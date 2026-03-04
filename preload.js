const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  videoInfo:  p  => ipcRenderer.invoke('video-info', p),
  compress:   o  => ipcRenderer.invoke('compress', o),
  split:      o  => ipcRenderer.invoke('split', o),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFolder: p  => ipcRenderer.invoke('open-folder', p),
  on:  (ch, fn)  => ipcRenderer.on(ch, (_, d) => fn(d)),
  off: ch        => ipcRenderer.removeAllListeners(ch)
})
