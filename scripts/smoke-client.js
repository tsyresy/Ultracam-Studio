const WebSocket = require('ws');
const https = require('https');

const base = process.env.ULTRACAM_URL || 'https://localhost:47900';

async function main() {
  const code = process.env.PAIRING_CODE;
  const deviceId = 'test-device-' + Date.now();
  const ws = new WebSocket(`${base}/signal`.replace('https://', 'wss://'), {
    rejectUnauthorized: false,
  });

  const log = (...a) => console.log('[phone]', ...a);

  ws.on('error', (e) => log('ws error:', e.message));
  ws.on('open', () => {
    log('signal open');
    ws.send(JSON.stringify({
      type: 'hello', protocol: 1, deviceName: 'TestPhone', platform: 'android', deviceId,
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    log('recv', msg);
    if (msg.type === 'welcome') {
      ws.send(JSON.stringify({ type: 'authenticate', deviceId, pairingCode: code }));
    }
    if (msg.type === 'authenticated') {
      ws.send(JSON.stringify({
        type: 'stream-start',
        video: { codec: 'h264', width: 1280, height: 720, fps: 30, bitrate: 4_000_000 },
        audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: 128000 },
      }));
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 300);
    }
    if (msg.type === 'pairing-required') {
      log('PAIRING FAILED');
      process.exit(2);
    }
  });
}

https.get(`${base}/health`.replace('https://', 'https://'), { rejectUnauthorized: false }, (res) => {
  let body = '';
  res.on('data', (c) => (body += c));
  res.on('end', () => {
    console.log('[phone] /health', body);
    main().catch((e) => { console.error(e); process.exit(1); });
  });
}).on('error', (e) => { console.error('health error', e.message); process.exit(1); });
