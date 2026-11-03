# Validation de livraison

## Vérifications automatisées
- Compilation croisée Windows WPF/.NET : réussie, y compris après les corrections finales.
- Tests .NET : 11 vérifications réussies (pixels, AVI, serveur, accès, fragmentation, commandes, renouvellement).
- TypeScript Expo : réussi.
- Analyse des liens d’appairage : cas valides/invalides et absence de dépendance au polyfill URL incomplet vérifiés.
- Android : compilation release finale réussie (correction du lien d’appairage incluse). Signature APK v2 vérifiée, certificat Ultracam propre au projet, application non destinée au débogage.

## Vérifications matérielles encore nécessaires
1. Windows 10/11 x64 : ouverture de l’EXE avec toutes les DLL du dossier, affichage correct des images fournies.
2. Installation administrateur des deux filtres, présence sous le nom Ultracam Remote Camera, désinstallation propre.
3. Android physique : autorisation/refus, QR, caméra arrière/avant, torche, zoom, rotation et passage en arrière-plan.
4. Flux continu pendant 30 minutes : mesurer cadence, latence, mémoire, température et consommation batterie.
5. OBS, Zoom, Teams et navigateur : image dans le bon sens, couleurs correctes et dimensions prises en charge. Tester applications 32 et 64 bits.
6. Photo et enregistrement : durée correcte, lecture AVI, arrêt après déconnexion et limite de taille.
7. Wi-Fi interrompu, mauvais lien, second téléphone, renouvellement de code : aucune connexion non autorisée et retour possible à un état connecté.
8. iOS : compilation Xcode, permission réseau local, caméra, connexion et contrôle ; aucun binaire iOS fourni ici.

Ne pas confondre réussite de compilation et validation d’usage réelle. Aucun test matériel de bout en bout n’a été réalisé dans cet environnement.
