# ✂ CutLink

**Traits de coupe automatiques pour Mimaki CJV150 / RasterLink7. Sans Illustrator, sans plugin.**

CutLink remplace le plugin *RasterLink Tools* d'Illustrator pour préparer des travaux **Print & Cut**. Vous ouvrez un visuel. L'outil trace une ligne de coupe par calque et exporte un PDF que RasterLink7 reconnaît directement.

🌐 **En ligne :** https://eviatek.fr/cutlink/ (bouton « Essayer un exemple »)

Tout le calcul se fait dans le navigateur : aucun fichier n'est envoyé sur un serveur.

---

## Fonctionnalités

| | |
|---|---|
| **Fichiers acceptés** | PSD/PSB avec calques, groupes et masques de fusion · PNG transparent · JPG ou WebP (fond uni retiré automatiquement) |
| **Un calque = une coupe** | Chaque calque reçoit son propre tracé. Les fonds pleine page et les calques masqués ou vides sont exclus automatiquement. |
| **Formes** | Contour du dessin, rectangle, rectangle arrondi, cercle, ellipse englobante |
| **Réglages par calque** | Décalage en mm (positif = marge blanche, négatif = coupe intérieure), lissage, regroupement des éléments proches (lettres d'un texte), trous intérieurs ignorés ou non, seuil d'opacité, suppression des petites pièces |
| **Noms de coupe** | `CutContour`, `CutContourHalf`, `CutContourFull` ou nom personnalisé. Chaque nom est vérifié (préfixe `CutContour` + caractères ASCII uniquement). |
| **Pas de double passage de lame** | Les coupes qui se chevauchent sont fusionnées en une seule. |
| **Planche** | Cadre de coupe autour de la planche (avec son propre nom, par ex. pour une pleine chair) · fond perdu sous la coupe (0 à 5 mm) |
| **Contrôles avant envoi** | Largeur maximale de la CJV150-75 (800 mm), pièces de moins de 4 mm, résolution trop faible, chevauchements, longueur totale de coupe |

## Format du PDF exporté

Le PDF suit la documentation Mimaki [RasterLink7 – Print & Cut](https://mimaki.com/manual/raster-link7/reference_guide/en-US/1050212235.html) :

- les tracés sont dans une **couleur d'accompagnement (Separation) nommée `CutContour…`**, avec un trait de 0,25 pt (réglable) et la surimpression activée ;
- chaque nom de coupe a son propre **calque PDF**, placé **au-dessus** du calque `Impression` ;
- l'image est **aplatie sur fond blanc, sans transparence**. Mimaki le recommande pour éviter qu'une coupe soit faite deux fois ou ne soit pas reconnue ([note Mimaki](https://mimaki.com/manual/raster-link7/reference_guide/en-US/515229323.html)) ;
- il existe deux exports : **impression + coupe**, ou **coupe seule**.

### Dans RasterLink7

1. Ouvrez le PDF comme un travail **Print & Cut**.
2. Associez à chaque nom (`CutContour`, `CutContourHalf`, `CutContourFull`…) ses conditions de coupe : pression, vitesse, mi-chair ou pleine chair.
3. RasterLink ajoute lui-même les repères d'alignement.

## Limites

- Les fichiers `.ai` et `.svg` ne sont pas lus : exportez en PSD ou en PNG transparent.
- Le contour est calculé à partir des pixels (carte de distances puis lissage). Erreur d'environ 0,05 mm en précision « Standard » sur un format A4.
- Pas encore testé sur toutes les versions de RasterLink. Vos retours sont les bienvenus.

## Lancer en local

L'application est entièrement statique : il suffit de servir le dossier `app/`.

```bash
cd app && python3 -m http.server 8080
# → http://localhost:8080
```

### Régénérer les bibliothèques (`app/libs.v1.js`)

```bash
cd build
npm install
npm run build:libs   # ag-psd + pdf-lib regroupés par esbuild
npm run demo         # régénère app/demo.psd
```

### Test de bout en bout

```bash
pip install playwright && playwright install chromium
python3 build/e2e.py http://localhost:8080/?demo
```

Le test charge le PSD d'exemple, vérifie la détection des calques, exporte le PDF et contrôle qu'il ne produit aucune erreur JavaScript.

## Structure

```
app/
  index.html      interface
  style.v1.css
  app.v2.js       moteur : calques → masque → carte de distances → marching squares → lissage → PDF
  libs.v1.js      ag-psd (lecture PSD) + pdf-lib (écriture PDF), regroupés
  demo.psd        fichier d'exemple
build/
  entry.js        point d'entrée du regroupement des bibliothèques
  mkdemo.js       générateur du PSD d'exemple
  e2e.py          test Playwright
```

## Licence

MIT. Les bibliothèques incluses dans `libs.v1.js` sont sous leurs propres licences : [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT) et [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT).

*Mimaki, RasterLink et CJV150 sont des marques de Mimaki Engineering Co., Ltd. Ce projet n'est pas affilié à Mimaki.*
