# Ultracam Studio Pro — version 0.1.1 (sources)

Application Windows native WPF/.NET, créée indépendamment. Aucun abonnement ni activation payante. Cette livraison est une première version technique ; ce n’est pas une réplique complète de Camo Pro.

## Démarrer

1. Sur Windows x64, extraire **tout** le dossier `release/win-x64` dans un dossier permanent. Conserver les DLL et le dossier `camera` à côté de `Ultracam Studio Pro.exe`. Le runtime .NET est inclus.
2. Lancer `Ultracam Studio Pro.exe` avec un compte normal.
3. Cliquer **Installer la caméra virtuelle** et accepter l’élévation Windows. Cela inscrit les filtres DirectShow 32/64 bits dans `Program Files\Ultracam Virtual Camera`, sous le nom **Ultracam Remote Camera**. Une règle de pare-feu limitée au sous-réseau local et au profil Privé autorise TCP 49721.
4. Placer PC et téléphone sur le même réseau privé. Sélectionner l’IP Wi-Fi/Ethernet correcte dans la liste du Studio (éviter VPN/Docker).
5. Installer l’APK Ultracam Remote Mobile, autoriser la caméra, puis scanner le QR depuis l’application mobile.
6. Dans Studio, activer **la sortie virtuelle**. Dans OBS, Zoom, Teams ou un navigateur, sélectionner **Ultracam Remote Camera**. Redémarrer le logiciel consommateur après installation si nécessaire.

Le filtre DirectShow constitue une voie de compatibilité large, mais aucune compatibilité universelle n’est garantie. Cette livraison n’a pas été exécutée sur un PC Windows ni avec un téléphone physique dans cet environnement Ubuntu. Les applications qui imposent exclusivement une source Media Foundation peuvent nécessiter une seconde implémentation. Le filtre utilise le canal partagé UnityCapture n° 0 : ne pas utiliser simultanément une autre application émettant sur ce canal.

## Fonctions présentes

- Appairage QR avec secret aléatoire de 256 bits, renouvelable ; une seule caméra connectée.
- Réception JPEG par WebSocket et aperçu natif WPF ; sortie fixe 1280 × 720.
- Commandes téléphone : caméra avant/arrière, torche et zoom selon capacités matérielles.
- Exposition numérique, contraste, saturation, température, gamma ; rotation, miroir et remplissage du cadre.
- Cinq préréglages de correction d’image. Ils ne remplacent pas l’arrière-plan et ne segmentent pas le sujet.
- Photo PNG et vidéo AVI/MJPEG sans audio à 15 fps dans `Vidéos\Ultracam`. La vidéo répète les dernières images pour maintenir le temps réel. Arrêt après perte de source ; taille limitée à environ 1,9 Go par fichier.
- Sortie virtuelle DirectShow libre MIT en 32/64 bits ; l’application Studio elle-même est x64.

## Limites et travail restant

Pas encore d’audio/microphone virtuel, de transport USB natif sans ADB, de H.264/HEVC matériel, de 4K/60 fps, de contrôle manuel ISO/vitesse/balance des blancs physique, de scènes multicaméra, de suivi de visage, de segmentation IA, de LUT, de diffusion RTMP ni d’installeur signé. Aucun bouton ne prétend activer ces fonctions.

Le transport actuel est **non chiffré** (`ws://`). Utiliser exclusivement un réseau privé de confiance. Le lien QR est un secret d’accès : ne pas le publier. Un pair présent sur le réseau peut observer le trafic. Les réglages et l’appairage ne sont pas persistés entre sessions.

Les fichiers Firebase fournis sont conservés côté mobile ; aucune connexion, collecte, facturation ou synchronisation cloud n’est implémentée.

## Compilation sans Git

SDK .NET 10 requis. Depuis ce dossier :

```powershell
.\scripts\build-windows.ps1
```

Depuis Linux, la compilation croisée est possible :

```sh
dotnet publish src/UltracamStudio/UltracamStudio.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o release/win-x64
cp -r camera release/win-x64/
```

Ne pas lancer uniquement l’EXE en le séparant de ses DLL natives. Le composant tiers est épinglé au commit indiqué dans `camera/PROVENANCE.json` ; sa licence et ses sources sont incluses dans ce projet.

## Vérification

```sh
dotnet run --project tests/Ultracam.Tests.csproj
```

Ces tests couvrent les corrections de pixels, la structure AVI, le serveur HTTP/WebSocket, les contrôles d’accès, la fragmentation et les commandes. Ils ne valident pas le rendu WPF ni DirectShow sur Windows. Voir `VALIDATION.md` pour les vérifications matérielles restantes.

## Désinstaller la caméra

Exécuter `camera/Uninstall-Camera.ps1` en administrateur. Le script retire l’inscription des filtres et la règle de pare-feu dédiée, sans supprimer vos captures.

## Mise à jour 0.1.1 — USB Android

Installer Android SDK Platform-Tools : le Studio recherche `adb.exe` dans `platform-tools` à côté de l’EXE, le SDK Android local, `ANDROID_HOME`/`ANDROID_SDK_ROOT`, puis le `PATH`. Aucun téléchargement automatique ni remplacement de votre ADB n’est effectué.

1. Brancher un câble de données, activer le débogage USB et autoriser ce PC sur Android.
2. Cliquer sur **Connecter en USB**. S’il y a plusieurs appareils, en sélectionner un puis recliquer.
3. Scanner le QR affiché avec Ultracam Remote Mobile. Le tunnel cible `127.0.0.1:49721` sur le téléphone.
4. Après reconnexion du câble, recliquer sur le bouton puis reconnecter l’application.

Le bouton prépare un tunnel ADB ; il ne prétend pas qu’une caméra transmet déjà. Le champ transport indique « Local / USB » pour une connexion de boucle locale et « Réseau » pour une connexion distante ; une connexion locale ne prouve pas à elle seule la présence d’un câble.

Le bouton **Actualiser le réseau Wi-Fi** recharge les adresses après un changement de réseau. Sélectionner l’IP correcte puis rescanner le QR pour changer de connexion.

Voir [CHANGELOG.md](CHANGELOG.md) pour les validations et les limites de cette version. Les exécutables existants du dossier `release` ne sont pas remplacés par cette modification des sources.
