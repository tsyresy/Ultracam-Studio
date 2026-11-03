# Historique des mises à jour

## 0.1.1 — 2026-11-03 — Sources préparées, non publiées

- Connexion Android par USB via ADB : recherche des appareils, sélection explicite en présence de plusieurs téléphones, contrôle d’autorisation, tunnel sur le port 49721 et QR de boucle locale.
- Exécution ADB sans shell, délai maximal de 15 secondes et messages pour ADB absent, téléphone non autorisé, appareil absent ou erreur de tunnel.
- Actualisation des adresses réseau depuis l’interface.
- Transport affiché selon la connexion reçue, avec la mention « Local / USB » qui ne présume pas qu’un câble a été détecté.
- Réutilisation des buffers de rendu et de caméra virtuelle (deux tableaux de 1280 × 720 × 4 octets) au lieu de réallocations à chaque image.
- Photo et début d’enregistrement refusés si la dernière image est périmée.
- Style de boutons WPF déjà partagé conservé ; ajout d’un indicateur de focus clavier. Pas d’animation continue dans le traitement vidéo.
- Suppression de la ressource d’écran de chargement embarquée mais non utilisée ; aucune dépendance ajoutée.
- Version des sources portée à 0.1.1.

Validation : compilation WPF Windows réussie depuis Linux et 16 contrôles automatisés réussis. Les cinq contrôles ADB utilisent un exécuteur simulé : ils vérifient sélection, autorisation, arguments et propagation des erreurs, pas un câble réel. Les 11 contrôles existants couvrent traitement de pixels, AVI et serveur WebSocket local.

À tester sur Windows + Android : interface, ADB réel, QR, flux Wi-Fi/USB, coupure/reconnexion, commandes caméra, fonctionnement continu de 30 minutes et sortie virtuelle. Les binaires de release précédents restent inchangés. Cette mise à jour des sources n’est pas encore publiée.
