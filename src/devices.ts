import { createHash, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { generateToken } from './protocol';

export interface PairedDevice {
  deviceId: string;
  deviceName: string;
  platform: string;
  pairedAt: string;
  lastSeenAt: string;
}

interface StoreShape {
  version: 1;
  devices: Record<string, PairedDevice & { tokenHash: string }>;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Magasin persistant des appareils appairés.
 *
 * Seul le SHA-256 du jeton est stocké : un accès en lecture au fichier ne
 * permet pas de rejouer une authentification.
 */
export class DeviceStore {
  private data: StoreShape;

  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.data = JSON.parse(readFileSync(filePath, 'utf8')) as StoreShape;
        if (!this.data.devices) this.data.devices = {};
      } catch {
        this.data = { version: 1, devices: {} };
      }
    } else {
      this.data = { version: 1, devices: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  list(): PairedDevice[] {
    return Object.values(this.data.devices).map(({ tokenHash: _omit, ...rest }) => rest);
  }

  isPaired(deviceId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data.devices, deviceId);
  }

  verifyToken(deviceId: string, token: string): boolean {
    const entry = this.data.devices[deviceId];
    if (!entry) return false;
    const a = Buffer.from(entry.tokenHash, 'hex');
    const b = Buffer.from(hashToken(token), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Ajoute un appareil et renvoie le jeton en clair (à ne jamais persister). */
  pair(device: {
    deviceId: string;
    deviceName: string;
    platform: string;
  }): { device: PairedDevice; token: string } {
    const token = generateToken();
    const now = new Date().toISOString();
    const entry = {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      pairedAt: now,
      lastSeenAt: now,
      tokenHash: hashToken(token),
    };
    this.data.devices[device.deviceId] = entry;
    this.persist();
    const { tokenHash: _omit, ...deviceInfo } = entry;
    return { device: deviceInfo, token };
  }

  /** Régénère le jeton d'un appareil déjà appairé (réappairage). */
  rotateToken(deviceId: string): { device: PairedDevice; token: string } | null {
    const entry = this.data.devices[deviceId];
    if (!entry) return null;
    const token = generateToken();
    entry.tokenHash = hashToken(token);
    entry.lastSeenAt = new Date().toISOString();
    this.persist();
    const { tokenHash: _omit, ...deviceInfo } = entry;
    return { device: deviceInfo, token };
  }

  touch(deviceId: string): void {
    const entry = this.data.devices[deviceId];
    if (!entry) return;
    entry.lastSeenAt = new Date().toISOString();
    this.persist();
  }

  unpair(deviceId: string): boolean {
    if (!this.data.devices[deviceId]) return false;
    delete this.data.devices[deviceId];
    this.persist();
    return true;
  }
}
