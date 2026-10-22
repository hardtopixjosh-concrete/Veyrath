import { contextBridge, ipcRenderer } from 'electron';

// The entire privileged surface the game page gets. No Node, no generic IPC.
contextBridge.exposeInMainWorld('veyrath', {
  getConfig: (): Promise<unknown> => ipcRenderer.invoke('veyrath:get-config'),
  smokeReport: (report: unknown): void => ipcRenderer.send('veyrath:smoke-report', report),
});
