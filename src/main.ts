import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { hostname } from 'os';
import { join } from 'path';
import { DeviceStore } from './devices';
import { UltracamServer } from './server';
import { loadOrCreateTlsMaterial } from './tls';
import { attachMjpegPreview } from './preview';
import { DEFAULT_PORT } from './protocol';

let server: UltracamServer | null = null;
let window: BrowserWindow | null = null;

function dataDir(): string {
  return app.getPath('userData');
}

async function boot(): Promise<void> {
  const dir = dataDir();
  const tls = loadOrCreateTlsMaterial(dir);
  const devices = new DeviceStore(join(dir, 'devices.json'));

  server = new UltracamServer({
    port: DEFAULT_PORT,
    studioName: `${hostname()} Studio`,
    dataDir: dir,
    tls,
    devices,
    serveUi: true,
    splashImagePath: assetPath('loading-screen.png'),
  });
  server.on('log', (level, message) => {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`${stamp} [${level}] ${message}`);
    window?.webContents.send('ultracam:log', { level, message, time: stamp });
  });
  attachMjpegPreview(server, process.env.ULTRACAM_FFMPEG ?? 'ffmpeg');
  await server.start();
  const code = server.refreshPairingCode();
  console.log(`Code d'appairage : ${code}`);
}

function assetPath(name: string): string {
  return join(app.getAppPath(), 'assets', name);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Ultracam Studio',
    icon: assetPath('icon.png'),
    backgroundColor: '#10131a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.session.setCertificateVerifyProc((request, callback) => {
    // Certificat auto-signé propre au Studio, chargé depuis le disque local.
    callback(request.hostname === 'localhost' ? 0 : -3);
  });

  window.once('ready-to-show', () => window?.show());

  window.loadURL(`https://localhost:${DEFAULT_PORT}/`);

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  window.on('closed', () => {
    window = null;
  });
}

ipcMain.handle('ultracam:state', () => ({
  pairingCode: server?.getPairingCode() ?? null,
  sessions: server?.listSessions() ?? [],
  devices: server?.listDevices() ?? [],
  obsUrl: server?.obsSourceUrl() ?? null,
}));

ipcMain.handle('ultracam:new-pairing-code', () => server?.refreshPairingCode() ?? null);

if (process.platform === 'win32') {
  // Identité de la barre des tâches (Windows regroupe par AppUserModelID).
  app.setAppUserModelId('app.ultracam.studio');
}

app.whenReady().then(async () => {
  await boot();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  server?.stop().catch(() => undefined);
});
