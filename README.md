# Ultracam Studio (desktop)

Récepteur de caméra distante : un téléphone (voir `../UtracamMobile`) diffuse sa
caméra par Wi-Fi ou USB, le Studio la reçoit et l'expose à OBS.

Implémentation **originale et indépendante** : aucun binaire ou protocole
propriétaire n'est réutilisé. Tout repose sur le protocole ouvert **Ultracam v1**
défini dans `src/protocol.ts` (miroir : `../UtracamMobile/src/protocol/constants.ts`).

---

## Démarrage rapide

```bash
cd UltraCamStudio
npm install
npm run build          # tsc -p .

npm run server         # ouvre le Studio en console
# ou
node dist/cli.js --ui --name "Mon Studio"
```

Options de `dist/cli.js` :

| option | effet |
|---|---|
| `--ui` | sert le tableau de bord HTML sur `https://localhost:47900/` |
| `--http` | autorise aussi le HTTP en clair (port 47901), utile pour un client qui refuse le certificat auto-signé |
| `--port <n>` | port HTTPS/WSS (défaut `47900`) |
| `--name <nom>` | nom annoncé en mDNS et affiché au téléphone |
| `--data-dir <dir>` | certificats + `devices.json` (défaut `~/.ultracam-studio`) |

Au démarrage, la console affiche :

```
Annonce mDNS _ultracam._tcp publiée
Studio en écoute : https://192.168.1.20:47900
Tableau de bord : https://localhost:47900/
Code d'appairage : 123456
```

Variante Electron (fenêtre native) : `npm start`.

### Prérequis

- Node.js 20+ (testé sur 20.x)
- `ffmpeg` sur le `PATH` pour l'aperçu MJPEG (`/obs.mjpg`). S'il est absent, la
  diffusion reste fonctionnelle mais l'aperçu OBS n'affiche rien. Chemin explicite
  via `ULTRACAM_FFMPEG=/chemin/vers/ffmpeg`.

---

## Protocole Ultracam v1

### Découverte

- mDNS : service `_ultracam._tcp`, TXT `proto=1`.
- Le téléphone cherche le Studio ; **le téléphone est toujours le client**.
- Port HTTPS/WSS par défaut : **47900**. HTTP en clair optionnel : **47901**.

### Points d'entrée HTTP

| route | rôle |
|---|---|
| `GET /health` | `{ ok, name, protocol, fingerprint }` — sondage sans authentification |
| `GET /devices` | liste des appareils appairés (public, sans secrets) |
| `GET /` et `/index.html` | tableau de bord (si `--ui`) |
| `GET /api/events` | flux SSE : rafraîchissement du tableau de bord |
| `POST /api/pairing` | régénère le code d'appairage (204) |
| `POST /api/unpair` | `{ deviceId }` — oublie un appareil (204) |
| `POST /api/settings` | `{ deviceId, settings }` — applique des réglages Pro (204) |
| `GET /obs` | page d'aide à l'ajout de la source dans OBS |
| `GET /obs.mjpg` | flux MJPEG de la session courante (source « Navigateur » OBS) |

### WebSockets

Deux WebSockets distincts, choisis par le sous-protocole ou le chemin :

- `wss://<studio>:47900/signal` — sous-protocole `ultracam.signal.v1`, JSON texte.
- `wss://<studio>:47900/media?deviceId=…` — sous-protocole `ultracam.media.v1`, binaire.

Flux signal :

```
téléphone                          studio
   |---------- hello -------------->|   { protocol, deviceId, deviceName, platform }
   |<--------- welcome -------------|   { studioName, authenticated }
   |---------- authenticate ------->|   { token? , pairingCode? }
   |<--------- authenticated -------|   { token, role: 'publisher' }
   |          (ou pairing-required) |
   |---------- settings-state ----->|   état complet des réglages Pro
   |<--------- settings ------------|   patch poussé depuis le tableau de bord
   |---------- stream-start ------->|   { video:{codec,width,height,fps,bitrate}, audio? }
   |---------- stream-stop -------->|
```

`ping`/`pong` maintiennent la connexion ; `error` porte `{ code, message }`.

### Authentification et autorisation média

1. Premier appairage : code à 6 chiffres, **valable 5 minutes**, affiché dans la
   console et le tableau de bord.
2. Succès ⇒ un **jeton opaque** est émis ; seul son hash est stocké dans
   `devices.json`. Les connexions suivantes présentent le jeton.
3. Le `/media` n'a **pas** de poignée de main JSON : il hérite d'une
   autorisation de 5 minutes (`AUTH_GRANT_TTL_MS`) accordée sur l'appareil lors
   de l'authentification `/signal` ou de l'appairage réussi.

### Trames média

En-tête fixe de 4 octets : `[streamId(1) | type(1) | flags(1) | réservé(1)]`.

| streamId | flux |
|---|---|
| 1 | vidéo |
| 2 | audio |

| type | nom |
|---|---|
| `0x01` | Headers |
| `0x02` | Config (SPS/PPS, AVCDecoderConfigurationRecord) |
| `0x03` | KeyFrame |
| `0x04` | DeltaFrame |
| `0x05` | AudioConfig |
| `0x06` | AudioFrame |
| `0x07` | EndHeaders |
| `0x08` | Metadata |

---

## Parité Pro

Le Studio **édite** les réglages Pro de chaque téléphone appairé depuis la
section « Réglages Pro » du tableau de bord (un formulaire par appareil) et les
pousse immédiatement au téléphone (`settings`). Les 26 réglages concernés :

`lens`, `zoom`, `torch`, `whiteBalance`, `exposureCompensation`, `focus`,
`brightness`, `contrast`, `saturation`, `gamma`, `sharpness`, `hue`, `preset`,
`hdr`, `stabilization`, `mirror`, `beauty`, `cleanFrame`,
`resolution.width`, `resolution.height`, `fps`, `bitrateKbps`, `codec`,
`audioEnabled`, `audioCodec`, `audioBitrateKbps`.

Le téléphone expose les mêmes réglages dans son écran « Réglages Pro »
(`../UtracamMobile/app/pro.tsx`) et les applique à la caméra + à l'encodeur
natif. Modèle de données : `ProSettings` + `DEFAULT_PRO_SETTINGS` dans
`src/protocol.ts`.

`POST /api/settings` accepte un **patch partiel** : il est fusionné avec les
réglages connus de l'appareil (defaut `DEFAULT_PRO_SETTINGS` sinon), avec un cas
particulier pour `resolution` afin qu'un `{width}` seul ne détruise pas `height`.

---

## Arborescence

```
src/
  protocol.ts   constantes + types partagés (référence)
  server.ts     serveur HTTPS/WSS, pairing, média, API tableau de bord
  devices.ts    registre d'appareils appairés (devices.json, jetons hachés)
  tls.ts        certificat auto-signé persistant
  ui.ts         tableau de bord HTML/JS (SSE + formulaires Pro)
  preview.ts    transcodage ffmpeg → MJPEG pour OBS
  decoder.ts    analyse des trames H.264/HEVC
  cli.ts        point d'entrée console
  main.ts       point d'entrée Electron
  preload.ts    pont Electron (fenêtre → API)
scripts/
  build.js         build production (tsc)
  smoke-client.js  test d'intégration (un téléphone simulé)
```

---

## Tests

```bash
# Typecheck
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

# Build
node scripts/build.js        # ou npm run build

# Intégration : un « téléphone » simulé s'appaire et ouvre un flux
node dist/cli.js --ui --name "TestStudio" &
PAIRING_CODE=<code affiché> node scripts/smoke-client.js
```

Le client de fumée quitte en code `2` avec `PAIRING FAILED` si aucun code valide
n'est fourni — c'est le comportement attendu, pas une régression.

---

## Limites connues

- Certificat **auto-signé** : le navigateur/OBS doit accepter l'exception, ou
  utiliser `--http` (47901) pour un client qui refuse le TLS.
- L'encodage (H.264/HEVC/AAC/Opus) est fait **sur le téléphone** ; le Studio ne
  transcode que pour l'aperçu MJPEG.
- Le module natif d'encodage mobile n'est pas compilé ici (pas de Xcode/Android
  SDK sur la machine de build) — voir `../UtracamMobile/modules/ultracam-encoder/README.md`.
