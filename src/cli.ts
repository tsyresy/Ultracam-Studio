import { mkdirSync } from 'fs';
import { homedir, hostname } from 'os';
import { join } from 'path';
import { DeviceStore } from './devices';
import { UltracamServer } from './server';
import { loadOrCreateTlsMaterial } from './tls';
import { attachMjpegPreview } from './preview';
import { DEFAULT_PORT } from './protocol';

function resolveFfmpeg(): string | null {
  const explicit = process.env.ULTRACAM_FFMPEG;
  if (explicit) return explicit;
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process');
    const out = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const port = args.port ? Number(args.port) : DEFAULT_PORT;
  const studioName = (args.name as string) || `${hostname()} Studio`;
  const dataDir = (args['data-dir'] as string) || join(homedir(), '.ultracam-studio');

  mkdirSync(dataDir, { recursive: true });
  const tls = loadOrCreateTlsMaterial(dataDir);
  const devices = new DeviceStore(join(dataDir, 'devices.json'));

  const server = new UltracamServer({
    port,
    studioName,
    dataDir,
    tls,
    devices,
    serveUi: Boolean(args.ui),
    allowPlainHttp: Boolean(args.http),
  });

  server.on('log', (level, message) => {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`${stamp} [${level}] ${message}`);
  });
  server.on('session', (s) =>
    console.log(`→ Session ${s.deviceName} (${s.video?.width}x${s.video?.height})`)
  );
  server.on('session-end', (s) => console.log(`← Session terminée ${s.deviceName}`));

  attachMjpegPreview(server, resolveFfmpeg());

  await server.start();

  if (args.ui) {
    console.log(`Tableau de bord : https://localhost:${port}/`);
  }
  console.log(`Code d'appairage : ${server.refreshPairingCode()}`);

  const shutdown = async () => {
    console.log('\nArrêt…');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
