import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { generate as generateSelfSigned } from 'selfsigned';

export interface TlsMaterial {
  key: string;
  cert: string;
  fingerprint: string;
}

/**
 * Charge (ou génère une première fois) un certificat auto-signé persistant.
 *
 * Le certificat n'est PAS l'identité de sécurité : l'authentification repose
 * sur le code d'appairage + jeton opaque. Le TLS chiffre le transport sur le
 * réseau local et permet au Studio d'annoncer HTTPS/mDNS.
 */
export function loadOrCreateTlsMaterial(dataDir: string): TlsMaterial {
  const dir = join(dataDir, 'certs');
  const keyPath = join(dir, 'ultracam.key.pem');
  const certPath = join(dir, 'ultracam.cert.pem');
  const metaPath = join(dir, 'ultracam.cert.json');

  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8'),
      fingerprint: existsSync(metaPath)
        ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { fingerprint: string }).fingerprint
        : '',
    };
  }

  const pems = generateSelfSigned(
    [
      { name: 'commonName', value: 'ultracam-studio.local' },
      { name: 'organizationName', value: 'Ultracam Studio (self-signed)' },
    ],
    {
      keySize: 2048,
      days: 3650,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: false },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'ultracam-studio.local' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ] as any[],
    }
  );

  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert, 'utf8');
  writeFileSync(
    metaPath,
    JSON.stringify({ fingerprint: pems.fingerprint, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  return { key: pems.private, cert: pems.cert, fingerprint: pems.fingerprint };
}
