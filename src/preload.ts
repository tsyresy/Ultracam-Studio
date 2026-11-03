import { contextBridge, ipcRenderer } from 'electron';

interface UltracamLog {
  level: string;
  message: string;
  time: string;
}

contextBridge.exposeInMainWorld('ultracam', {
  getState: () => ipcRenderer.invoke('ultracam:state'),
  newPairingCode: () => ipcRenderer.invoke('ultracam:new-pairing-code'),
  onLog: (callback: (entry: UltracamLog) => void) => {
    const listener = (_event: unknown, entry: UltracamLog) => callback(entry);
    ipcRenderer.on('ultracam:log', listener);
    return () => ipcRenderer.removeListener('ultracam:log', listener);
  },
});
