/**
 * Protocole Ultracam — constantes partagées entre Ultracam Studio (PC) et
 * Ultracam Mobile (téléphone).
 *
 * La version TypeScript fait foi ; le fichier équivalent côté mobile est
 * `UtracamMobile/src/protocol/constants.ts` et doit rester identique.
 */

import { randomBytes, randomInt } from 'crypto';

/** Version du protocole applicatif. */
export const PROTOCOL_VERSION = 1;

/** Type de service mDNS annoncé par le Studio. */
export const SERVICE_TYPE = 'ultracam';

/** Sous-protocoles textuels (champ WebSocket `Sec-WebSocket-Protocol`). */
export const WS_SUBPROTOCOL_SIGNAL = 'ultracam.signal.v1';
export const WS_SUBPROTOCOL_MEDIA = 'ultracam.media.v1';

/** Port HTTP/WebSocket par défaut du Studio. */
export const DEFAULT_PORT = 47900;

/** Types de messages de signalisation (JSON, texte WebSocket). */
export enum SignalType {
  Hello = 'hello',
  Welcome = 'welcome',
  Authenticate = 'authenticate',
  Authenticated = 'authenticated',
  PairingRequired = 'pairing-required',
  StreamStart = 'stream-start',
  StreamStop = 'stream-stop',
  Stats = 'stats',
  Ping = 'ping',
  Pong = 'pong',
  Error = 'error',
  /** Le Studio dicte au téléphone une modification de réglage. */
  Settings = 'settings',
  /** Le téléphone confirme l'état complet de ses réglages. */
  SettingsState = 'settings-state',
}

/** Types de frame média (binaire WebSocket, un octet après l'en-tête). */
export enum MediaFrameType {
  Headers = 0x01,
  Config = 0x02,
  KeyFrame = 0x03,
  DeltaFrame = 0x04,
  AudioConfig = 0x05,
  AudioFrame = 0x06,
  EndHeaders = 0x07,
  Metadata = 0x08,
}

/** En-tête média fixe : 4 octets. */
export const MEDIA_HEADER_SIZE = 4;

/** Identifiant de flux vidéo principal. */
export const VIDEO_STREAM_ID = 1;

/** Identifiant de flux audio. */
export const AUDIO_STREAM_ID = 2;

/** Taille du préfixe d'en-tête de trame fixe (streamId + type + flags + réservé). */
export const FRAME_HEADER_SIZE = MEDIA_HEADER_SIZE;

export interface MediaFrameHeader {
  streamId: number;
  type: MediaFrameType;
  flags: number;
}

/** Encapsule un payload dans une trame média Ultracam. */
export function encodeMediaFrame(
  streamId: number,
  type: MediaFrameType,
  payload: Uint8Array,
  flags = 0
): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_SIZE + payload.byteLength);
  out[0] = streamId & 0xff;
  out[1] = type & 0xff;
  out[2] = flags & 0xff;
  out[3] = 0;
  out.set(payload, FRAME_HEADER_SIZE);
  return out;
}

/** Lit l'en-tête d'une trame média Ultracam. */
export function decodeMediaHeader(bytes: Uint8Array): MediaFrameHeader {
  if (bytes.byteLength < FRAME_HEADER_SIZE) {
    throw new Error('Ultracam: média tronqué (< 4 octets)');
  }
  return {
    streamId: bytes[0],
    type: bytes[1] as MediaFrameType,
    flags: bytes[2],
  };
}

export interface HelloMessage {
  type: SignalType.Hello;
  protocol: number;
  deviceName: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  /** Empreinte stable de l'appareil (non secrète). */
  deviceId: string;
}

export interface WelcomeMessage {
  type: SignalType.Welcome;
  protocol: number;
  studioName: string;
  /** true si la paire est déjà authentifiée pour cet appareil. */
  authenticated: boolean;
}

export interface AuthenticateMessage {
  type: SignalType.Authenticate;
  deviceId: string;
  /** Code d'appairage à 6 chiffres lu à l'écran du Studio. */
  pairingCode?: string;
  /** Jeton persistant renvoyé après un appairage réussi. */
  token?: string;
}

export interface AuthenticatedMessage {
  type: SignalType.Authenticated;
  token: string;
  role: 'publisher';
}

export interface StreamStartMessage {
  type: SignalType.StreamStart;
  video: {
    codec: 'h264' | 'hevc';
    width: number;
    height: number;
    fps: number;
    bitrate: number;
  };
  audio?: {
    codec: 'aac' | 'opus';
    sampleRate: number;
    channels: number;
    bitrate: number;
  };
}

export interface StreamStatsMessage {
  type: SignalType.Stats;
  fps: number;
  bitrate: number;
  droppedFrames: number;
  rttMillis: number;
}

/**
 * Réglages « Pro » partagés par le téléphone et le Studio.
 *
 * L'interface est volontairement plate pour faciliter sa sérialisation JSON et
 * son rendu identique sur les deux plateformes.
 */
export interface ProSettings {
  /** Mode caméra : mise au point / exposition / balance des blancs. */
  lens: 'front' | 'back';
  zoom: number;
  torch: boolean;
  /** Balance des blancs en kelvins ; 0 = automatique. */
  whiteBalance: number;
  /** Correction d'exposition en unités de -2 à +2. */
  exposureCompensation: number;
  focus: number;
  /** Ajustements d'image appliqués par le Studio. */
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  sharpness: number;
  hue: number;
  /** Style prédéfini (aucun, cinéma, monochrome, chaud, froid...). */
  preset: string;
  hdr: boolean;
  stabilization: boolean;
  mirror: boolean;
  /** Couche d'effets de beauté / ML. */
  beauty: number;
  /** Sortie en mode « image propre » (JPEG sans incrustations). */
  cleanFrame: boolean;
  resolution: { width: number; height: number };
  fps: number;
  bitrateKbps: number;
  codec: 'h264' | 'hevc';
  audioEnabled: boolean;
  audioCodec: 'aac' | 'opus';
  audioBitrateKbps: number;
}

export const DEFAULT_PRO_SETTINGS: ProSettings = {
  lens: 'back',
  zoom: 1,
  torch: false,
  whiteBalance: 0,
  exposureCompensation: 0,
  focus: 0.5,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 1,
  sharpness: 0,
  hue: 0,
  preset: 'none',
  hdr: false,
  stabilization: true,
  mirror: true,
  beauty: 0,
  cleanFrame: true,
  resolution: { width: 1280, height: 720 },
  fps: 30,
  bitrateKbps: 6000,
  codec: 'h264',
  audioEnabled: true,
  audioCodec: 'opus',
  audioBitrateKbps: 128,
};

/** Réglages envoyés au téléphone ; chaque champ est facultatif (patch). */
export interface SettingsMessage {
  type: SignalType.Settings;
  settings: Partial<ProSettings>;
}

/** État complet des réglages du téléphone. */
export interface SettingsStateMessage {
  type: SignalType.SettingsState;
  settings: ProSettings;
}

export type SignalMessage =
  | HelloMessage
  | WelcomeMessage
  | AuthenticateMessage
  | AuthenticatedMessage
  | StreamStartMessage
  | StreamStatsMessage
  | SettingsMessage
  | SettingsStateMessage
  | { type: SignalType.StreamStop | SignalType.Ping | SignalType.Pong }
  | ErrorMessage
  | PairingRequiredMessage;

export interface ErrorMessage {
  type: SignalType.Error;
  code: string;
  message: string;
}

export interface PairingRequiredMessage {
  type: SignalType.PairingRequired;
}

export function encodeSignal(msg: SignalMessage): string {
  return JSON.stringify(msg);
}

export function decodeSignal(data: string): SignalMessage {
  const parsed = JSON.parse(data) as SignalMessage;
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as any).type !== 'string') {
    throw new Error('Ultracam: message de signalisation invalide');
  }
  return parsed;
}

/** Génère un code d'appairage à 6 chiffres cryptographiquement sûr. */
export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Génère un jeton d'appairage opaque. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
