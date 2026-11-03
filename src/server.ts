import { createServer as createHttpServer, IncomingMessage, Server } from 'http';
import { createServer as createHttpsServer, Server as HttpsServer } from 'https';
import { networkInterfaces } from 'os';
import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { Bonjour, Service } from 'bonjour-service';
import { DeviceStore, PairedDevice } from './devices';
import { TlsMaterial } from './tls';
import { AppState, LOG_LIMIT, renderIndex } from './ui';
import {
  DEFAULT_PORT,
  DEFAULT_PRO_SETTINGS,
  HelloMessage,
  MediaFrameType,
  PROTOCOL_VERSION,
  ProSettings,
  SERVICE_TYPE,
  SignalMessage,
  SignalType,
  WS_SUBPROTOCOL_MEDIA,
  WS_SUBPROTOCOL_SIGNAL,
  decodeMediaHeader,
  decodeSignal,
  encodeSignal,
  generatePairingCode,
} from './protocol';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ServerOptions {
  port?: number;
  studioName: string;
  dataDir: string;
  tls: TlsMaterial;
  devices: DeviceStore;
  /** Écoute HTTP en clair en plus de HTTPS (développement uniquement). */
  allowPlainHttp?: boolean;
  /** Page de contrôle HTML (la CLI s'en passe). */
  serveUi?: boolean;
  /** Écran de lancement affiché pendant le démarrage (`?embed=splash`). */
  splashImagePath?: string;
}

export interface SessionInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  authenticated: boolean;
  startedAt: string;
  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
  };
  audio?: { codec: string; sampleRate: number; channels: number; bitrate: number };
  frames: number;
  bytes: number;
  lastFrameAt: string | null;
}

export interface MediaSink {
  onVideoHeaders(payload: Uint8Array, session: SessionInfo): void;
  onVideoConfig(payload: Uint8Array, session: SessionInfo): void;
  onVideoFrame(
    keyframe: boolean,
    payload: Uint8Array,
    session: SessionInfo,
    timestampMicros: number
  ): void;
  onAudioConfig?(payload: Uint8Array, session: SessionInfo): void;
  onAudioFrame?(payload: Uint8Array, session: SessionInfo): void;
}

interface PeerState {
  ws: WebSocket;
  kind: 'signal' | 'media';
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  authenticated: boolean;
  session?: SessionInfo;
}

/**
 * Récepteur Ultracam Studio : HTTP(S) + WebSocket, signalisation et média.
 *
 * URL :
 *   GET  /health                → { ok, name, protocol, fingerprint }
 *   WS   /signal                → signalisation JSON (hello/welcome/authenticate)
 *   WS   /media                 → trames binaires multiplexées par streamId
 */
export class UltracamServer extends EventEmitter {
  private httpServer: Server | HttpsServer | null = null;
  private wss: WebSocketServer | null = null;
  private bonjour: Bonjour | null = null;
  private published: Service | null = null;
  private readonly port: number;
  private sink: MediaSink | null = null;
  private pairingCode: string | null = null;
  private pairingCodeExpires = 0;
  private readonly sessions = new Map<string, SessionInfo>();
  /**
   * Appareils authentifiés par la session de signalisation, avec l'échéance de
   * validité. Le canal média n'a pas sa propre poignée de main : il hérite de
   * l'authentification de signalisation du même appareil pendant une courte
   * fenêtre afin qu'une même app puisse ouvrir `/media` juste après.
   */
  private readonly authGrants = new Map<string, { expires: number }>();
  private static readonly AUTH_GRANT_TTL_MS = 5 * 60_000;
  private readonly recentLog: AppState['log'] = [];
  private latestJpeg: { data: Buffer; time: number } | null = null;
  private lastJpegAt = 0;
  private splashBuffer: Buffer | null | undefined;
  private readonly uiClients = new Set<import('http').ServerResponse>();
  private readonly peers = new Set<PeerState>();
  private readonly settingsByDevice = new Map<string, ProSettings>();
  private starting = false;

  constructor(private readonly opts: ServerOptions) {
    super();
    this.port = opts.port ?? DEFAULT_PORT;
  }

  setSink(sink: MediaSink | null): void {
    this.sink = sink;
  }

  getPort(): number {
    return this.port;
  }

  getFingerprint(): string {
    return this.opts.tls.fingerprint;
  }

  getPairingCode(): string | null {
    return this.pairingCode && this.pairingCodeExpires > Date.now() ? this.pairingCode : null;
  }

  /** Émet (ou réémet) un code d'appairage unique pendant 5 minutes. */
  refreshPairingCode(): string {
    this.pairingCode = generatePairingCode();
    this.pairingCodeExpires = Date.now() + 5 * 60_000;
    return this.pairingCode;
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  listDevices(): PairedDevice[] {
    return this.opts.devices.list();
  }

  /** Derniers réglages connus pour un appareil (null s'il n'en a pas envoyé). */
  getSettings(deviceId: string): ProSettings | null {
    return this.settingsByDevice.get(deviceId) ?? null;
  }

  unpair(deviceId: string): boolean {
    return this.opts.devices.unpair(deviceId);
  }

  private log(level: LogLevel, msg: string): void {
    this.emit('log', level, msg);
    this.recentLog.push({ level, time: new Date().toLocaleTimeString(), message: msg });
    if (this.recentLog.length > LOG_LIMIT) this.recentLog.shift();
  }

  private address(): string {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] ?? []) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
    return '127.0.0.1';
  }

  async start(): Promise<void> {
    if (this.starting || this.httpServer) return;
    this.starting = true;
    try {
      const handler = (req: IncomingMessage, res: import('http').ServerResponse) =>
        this.handleHttp(req, res);

      const https = createHttpsServer(
        { key: this.opts.tls.key, cert: this.opts.tls.cert },
        handler
      );
      this.wss = new WebSocketServer({ server: https, maxPayload: 64 * 1024 * 1024 });
      this.bindWebSocketHandlers(this.wss);
      await this.listen(https, this.port);
      this.httpServer = https;

      if (this.opts.allowPlainHttp) {
        const http = createHttpServer(handler);
        const wssPlain = new WebSocketServer({ server: http, maxPayload: 64 * 1024 * 1024 });
        this.bindWebSocketHandlers(wssPlain);
        await this.listen(http, this.port + 1);
      }

      this.startBonjour();
      const scheme = 'https';
      this.log('info', `Studio en écoute : ${scheme}://${this.address()}:${this.port}`);
    } catch (err) {
      this.log('error', `Échec du démarrage : ${(err as Error).message}`);
      throw err;
    } finally {
      this.starting = false;
    }
  }

  private listen(server: Server | HttpsServer, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', onError);
        resolve();
      });
    });
  }

  private startBonjour(): void {
    try {
      this.bonjour = new Bonjour();
      this.published = this.bonjour.publish({
        name: `${this.opts.studioName} (${this.address()})`,
        type: SERVICE_TYPE,
        protocol: 'tcp',
        port: this.port,
        txt: {
          protocol: String(PROTOCOL_VERSION),
          name: this.opts.studioName,
          tls: '1',
          plain: this.opts.allowPlainHttp ? '1' : '0',
          fingerprint: this.opts.tls.fingerprint.slice(0, 32),
        },
      });
      this.log('info', `Annonce mDNS _${SERVICE_TYPE}._tcp publiée`);
    } catch (err) {
      this.log('warn', `mDNS indisponible : ${(err as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    for (const peer of this.wss?.clients ?? []) {
      try {
        peer.close(1001, 'studio shutting down');
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
    });
    if (this.published) {
      try {
        this.published.stop?.(() => undefined);
      } catch {
        /* ignore */
      }
    }
    this.bonjour?.destroy();
    this.wss = null;
    this.httpServer = null;
    this.published = null;
    this.bonjour = null;
  }

  /** URL annoncée comme source OBS (page des snapshots JPEG décodés). */
  obsSourceUrl(): string | null {
    if (!this.opts.serveUi) return null;
    return `https://${this.address()}:${this.port}/obs`;
  }

  /** Image d'écran de lancement, lue une seule fois puis servie depuis la mémoire. */
  private splashImage(): Buffer | null {
    if (this.splashBuffer !== undefined) return this.splashBuffer;
    if (!this.opts.splashImagePath) {
      this.splashBuffer = null;
      return null;
    }
    try {
      this.splashBuffer = readFileSync(this.opts.splashImagePath);
    } catch {
      this.splashBuffer = null;
    }
    return this.splashBuffer;
  }

  private notifyUi(): void {
    for (const res of this.uiClients) res.write('data: {"reload":true}\n\n');
  }

  private stateSnapshot(): AppState {
    return {
      name: this.opts.studioName,
      protocol: PROTOCOL_VERSION,
      address: this.address(),
      port: this.port,
      fingerprint: this.opts.tls.fingerprint,
      pairingCode: this.getPairingCode(),
      sessions: this.listSessions(),
      devices: this.listDevices(),
      splash: this.splashImage() !== null,
      settings: Object.fromEntries(this.settingsByDevice),
      log: this.recentLog,
      obsUrl: this.obsSourceUrl(),
    };
  }

  /** Reçoit une image JPEG décodée pour la source OBS/aperçu. */
  setLatestJpeg(jpeg: Buffer): void {
    const now = Date.now();
    if (now - this.lastJpegAt < 15) return;
    this.lastJpegAt = now;
    this.latestJpeg = { data: jpeg, time: now };
  }

  private handleHttp(req: IncomingMessage, res: import('http').ServerResponse): void {
    const url = req.url ?? '/';
    const path = url.split('?')[0];

    if (this.opts.serveUi) {
      if (req.method === 'GET' && path === '/splash.png') {
        const image = this.splashImage();
        if (!image) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' });
        res.end(image);
        return;
      }
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderIndex(this.stateSnapshot()));
        return;
      }
      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        this.uiClients.add(res);
        req.on('close', () => this.uiClients.delete(res));
        return;
      }
      if (req.method === 'POST' && path === '/api/pairing') {
        this.refreshPairingCode();
        this.notifyUi();
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'POST' && path === '/api/unpair') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { deviceId } = JSON.parse(body) as { deviceId: string };
            this.opts.devices.unpair(deviceId);
          } catch {
            /* ignore */
          }
          this.notifyUi();
          res.writeHead(204);
          res.end();
        });
        return;
      }
      if (req.method === 'POST' && path === '/api/settings') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { deviceId, settings } = JSON.parse(body) as {
              deviceId: string;
              settings: Partial<ProSettings>;
            };
            if (deviceId && settings) {
              const merged: ProSettings = { ...(this.getSettings(deviceId) ?? DEFAULT_PRO_SETTINGS), ...settings };
              if (settings.resolution) {
                merged.resolution = { ...DEFAULT_PRO_SETTINGS.resolution, ...settings.resolution };
              }
              this.settingsByDevice.set(deviceId, merged);
              this.broadcastSettings(deviceId, merged);
              this.log('info', `Réglages Pro appliqués : ${deviceId}`);
            }
          } catch {
            /* ignore */
          }
          this.notifyUi();
          res.writeHead(204);
          res.end();
        });
        return;
      }
      if (req.method === 'GET' && path === '/obs') {
        const last = this.latestJpeg;
        if (!last) {
          res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Aucune image disponible : connectez un telephone.');
          return;
        }
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'cache-control': 'no-store',
        });
        res.end(last.data);
        return;
      }
      if (req.method === 'GET' && path === '/obs.mjpg') {
        res.writeHead(200, {
          'content-type': 'multipart/x-mixed-replace; boundary=ultracamframe',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        const timer = setInterval(() => {
          const current = this.latestJpeg;
          if (!current) return;
          res.write('--ultracamframe\r\n');
          res.write('Content-Type: image/jpeg\r\n');
          res.write('Content-Length: ' + current.data.length + '\r\n\r\n');
          res.write(current.data);
          res.write('\r\n');
        }, 66);
        req.on('close', () => clearInterval(timer));
        return;
      }
    }

    if (req.method === 'GET' && path.startsWith('/health')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(
        JSON.stringify({
          ok: true,
          name: this.opts.studioName,
          protocol: PROTOCOL_VERSION,
          fingerprint: this.opts.tls.fingerprint,
        })
      );
      return;
    }
    if (req.method === 'GET' && url.startsWith('/devices')) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ devices: this.listDevices() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  }

  private bindWebSocketHandlers(wss: WebSocketServer): void {
    wss.on('connection', (ws, req) => {
      const path = (req.url ?? '/').split('?')[0];
      const protocols = (req.headers['sec-websocket-protocol'] ?? '') as string;
      const wantsMedia = path.startsWith('/media') || protocols.includes(WS_SUBPROTOCOL_MEDIA);
      const deviceId = this.deviceIdFromQuery(req.url ?? '');
      const peer: PeerState = {
        ws,
        kind: wantsMedia ? 'media' : 'signal',
        deviceId: deviceId ?? undefined,
        authenticated: deviceId ? this.hasRecentGrant(deviceId) : false,
      };
      if (peer.authenticated) {
        const session = this.sessions.get(deviceId!);
        if (session) {
          peer.deviceName = session.deviceName;
          peer.platform = session.platform;
          // Le pair média référence la session mais ne la possède pas : seule
          // la fermeture du canal de signalisation la termine.
          peer.session = session;
        }
      }
      this.peers.add(peer);
      this.log('info', `Connexion ${peer.kind} depuis ${req.socket.remoteAddress}`);

      ws.on('message', (data, isBinary) => {
        try {
          if (peer.kind === 'signal') {
            this.onSignalMessage(peer, String(isBinary ? Buffer.from(data as any).toString('utf8') : data));
          } else {
            this.onMediaFrame(peer, Buffer.from(data as any));
          }
        } catch (err) {
          this.log('warn', `Trame rejetée : ${(err as Error).message}`);
        }
      });

      ws.on('close', () => {
        this.peers.delete(peer);
        if (peer.kind === 'signal' && peer.session) {
          this.sessions.delete(peer.deviceId ?? '');
          this.emit('session-end', peer.session);
          this.log('info', `Session terminée : ${peer.session.deviceName}`);
          this.notifyUi();
        }
      });

      ws.on('error', (err) => this.log('warn', `WebSocket : ${err.message}`));
    });
  }

  private send(peer: PeerState, msg: SignalMessage): void {
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(encodeSignal(msg));
  }

  private onSignalMessage(peer: PeerState, raw: string): void {
    const msg = decodeSignal(raw);
    switch (msg.type) {
      case SignalType.Hello: {
        const hello = msg as HelloMessage;
        if (hello.protocol !== PROTOCOL_VERSION) {
          this.send(peer, {
            type: SignalType.Error,
            code: 'protocol_mismatch',
            message: `Ultracam protocol ${PROTOCOL_VERSION} required (client sent ${hello.protocol})`,
          });
          this.log('warn', `Protocole incompatible : ${hello.protocol}`);
          peer.ws.close(1002, 'protocol mismatch');
          return;
        }
        peer.deviceId = hello.deviceId;
        peer.deviceName = hello.deviceName;
        peer.platform = hello.platform;
        const authenticated = this.opts.devices.isPaired(hello.deviceId);
        this.send(peer, {
          type: SignalType.Welcome,
          protocol: PROTOCOL_VERSION,
          studioName: this.opts.studioName,
          authenticated,
        });
        this.log('info', `Appareil présenté : ${hello.deviceName} (${hello.platform})`);
        return;
      }
      case SignalType.Authenticate: {
        const auth = msg as Extract<SignalMessage, { type: SignalType.Authenticate }>;
        if (!peer.deviceId) {
          peer.ws.close(1008, 'hello required');
          return;
        }
        if (auth.token && this.opts.devices.verifyToken(peer.deviceId, auth.token)) {
          peer.authenticated = true;
          this.opts.devices.touch(peer.deviceId);
          this.grantMediaAccess(peer.deviceId);
          this.send(peer, {
            type: SignalType.Authenticated,
            token: auth.token,
            role: 'publisher',
          });
          this.log('info', `Appareil authentifié par jeton : ${peer.deviceName}`);
          return;
        }
        const expected = this.getPairingCode() ?? this.refreshPairingCode();
        if (auth.pairingCode && auth.pairingCode === expected) {
          const result = this.opts.devices.pair({
            deviceId: peer.deviceId,
            deviceName: peer.deviceName ?? 'Appareil',
            platform: peer.platform ?? 'unknown',
          });
          peer.authenticated = true;
          this.pairingCode = null;
          this.grantMediaAccess(peer.deviceId);
          this.send(peer, {
            type: SignalType.Authenticated,
            token: result.token,
            role: 'publisher',
          });
          this.emit('device-paired', result.device);
          this.notifyUi();
          this.log('info', `Nouvel appairage : ${result.device.deviceName}`);
          return;
        }
        this.send(peer, { type: SignalType.PairingRequired });
        return;
      }
      case SignalType.StreamStart: {
        if (!peer.authenticated) {
          peer.ws.close(1008, 'not authenticated');
          return;
        }
        const start = msg as Extract<SignalMessage, { type: SignalType.StreamStart }>;
        const session: SessionInfo = {
          deviceId: peer.deviceId!,
          deviceName: peer.deviceName ?? 'Appareil',
          platform: peer.platform ?? 'unknown',
          authenticated: true,
          startedAt: new Date().toISOString(),
          video: start.video,
          audio: start.audio,
          frames: 0,
          bytes: 0,
          lastFrameAt: null,
        };
        peer.session = session;
        this.sessions.set(session.deviceId, session);
        this.emit('session', session);
        this.notifyUi();
        this.log('info', `Flux démarré : ${session.video?.width}x${session.video?.height}@${session.video?.fps}`);
        return;
      }
      case SignalType.StreamStop: {
        if (peer.session) {
          this.sessions.delete(peer.deviceId ?? '');
          this.emit('session-end', peer.session);
          this.notifyUi();
          peer.session = undefined;
        }
        return;
      }
      case SignalType.SettingsState: {
        if (!peer.authenticated) return;
        const state = msg as Extract<SignalMessage, { type: SignalType.SettingsState }>;
        this.settingsByDevice.set(peer.deviceId!, state.settings);
        this.emit('settings', peer.deviceId, state.settings);
        return;
      }
      case SignalType.Ping:
        this.send(peer, { type: SignalType.Pong });
        return;
      default:
        return;
    }
  }

  /** Lit `?deviceId=…` dans l'URL (canal média, journalisation). */
  private deviceIdFromQuery(url: string): string | null {
    const index = url.indexOf('?');
    if (index < 0) return null;
    const query = url.slice(index + 1);
    for (const pair of query.split('&')) {
      const [key, value] = pair.split('=');
      if (key === 'deviceId' && value) return decodeURIComponent(value);
    }
    return null;
  }

  /** Accorde (ou prolonge) l'accès du canal média pour un appareil authentifié. */
  private grantMediaAccess(deviceId: string): void {
    this.authGrants.set(deviceId, { expires: Date.now() + UltracamServer.AUTH_GRANT_TTL_MS });
  }

  private hasRecentGrant(deviceId: string): boolean {
    const grant = this.authGrants.get(deviceId);
    if (!grant) return false;
    if (grant.expires <= Date.now()) {
      this.authGrants.delete(deviceId);
      return false;
    }
    return true;
  }

  /**
   * Diffuse un changement de réglage vers les pairs authentifiés de l'appareil
   * (signal et média).
   */
  broadcastSettings(deviceId: string, settings: Partial<ProSettings>): void {
    for (const peer of this.peers) {
      if (peer.deviceId === deviceId && peer.authenticated) {
        this.send(peer, { type: SignalType.Settings, settings });
      }
    }
  }

  private mediaSession(peer: PeerState): SessionInfo | undefined {
    return peer.session;
  }

  private onMediaFrame(peer: PeerState, frame: Buffer): void {
    if (frame.byteLength < 4) return;
    const header = decodeMediaHeader(frame);
    const payload = frame.subarray(4);
    const session = this.mediaSession(peer);
    if (!session || !peer.authenticated) {
      // Les en-têtes/configuration arrivent parfois juste avant stream-start.
      if (header.type === MediaFrameType.Headers || header.type === MediaFrameType.Config) {
        this.log('info', 'En-tête média reçu avant stream-start — ignoré');
      }
      return;
    }
    session.frames += 1;
    session.bytes += payload.byteLength;
    session.lastFrameAt = new Date().toISOString();

    switch (header.type) {
      case MediaFrameType.Headers:
        this.sink?.onVideoHeaders(new Uint8Array(payload), session);
        break;
      case MediaFrameType.Config:
        this.sink?.onVideoConfig(new Uint8Array(payload), session);
        break;
      case MediaFrameType.KeyFrame:
        this.sink?.onVideoFrame(true, new Uint8Array(payload), session, Date.now() * 1000);
        break;
      case MediaFrameType.DeltaFrame:
        this.sink?.onVideoFrame(false, new Uint8Array(payload), session, Date.now() * 1000);
        break;
      case MediaFrameType.AudioConfig:
        this.sink?.onAudioConfig?.(new Uint8Array(payload), session);
        break;
      case MediaFrameType.AudioFrame:
        this.sink?.onAudioFrame?.(new Uint8Array(payload), session);
        break;
      default:
        break;
    }
  }
}
