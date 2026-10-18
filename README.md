# ✂ CutLink

**Du visuel à la coupe sur Mimaki CJV150 / RasterLink7. Sans Illustrator, sans plugin.**

CutLink se place entre l'outil de création (Photoshop, Illustrator, Canva…) et le RIP. Il trace les lignes de coupe, compose la planche sur la laize de la machine et exporte un PDF *Print & Cut* que RasterLink7 reconnaît directement.

Tout le calcul se fait dans le navigateur : aucun fichier n'est envoyé sur un serveur.

## Fonctionnalités

| | |
|---|---|
| **Fichiers acceptés** | PSD/PSB (calques, groupes, masques de fusion) · **AI** (enregistré avec « Créer un fichier compatible PDF ») · **PDF** (Illustrator, Canva, Affinity…) · **SVG** (unités mm/cm/in/pt/px) · PNG transparent · JPG, WebP, GIF, BMP (fond uni détouré automatiquement) |
| **Coupes déjà faites dans Illustrator** | Les tracés en nuance `CutContour…` d'un AI/PDF sont **repris tels quels** (courbes, tracés ouverts, formulaires XObject, rotation de page) et retirés de l'image imprimée. Les autres calques peuvent recevoir un contour automatique. |
| **Un calque = une coupe** | Formes : contour du dessin, rectangle, rectangle arrondi, cercle, ellipse. Décalage en mm, lissage, regroupement des éléments proches (lettres d'un texte), trous ignorés ou non, seuil d'opacité, suppression des petites pièces. |
| **Planche** | Plusieurs visuels, nombre d'exemplaires, imbrication automatique en étagères sur la laize utile (rotation 90° optionnelle), placement à la main (glisser, flèches, R pour pivoter), cadre de coupe autour du travail. |
| **Support** | Largeur du rouleau (810 mm max), réserve pour les repères RasterLink, espacement entre exemplaires. |
| **Contrôles avant envoi** | Largeur 800 mm, zone des repères, chevauchements entre exemplaires, pièces < 4 mm, résolution, noms de coupe, longueur > 1 m entre repères. |
| **Récapitulatif** | Longueur de coupe, temps de coupe estimé, support consommé (m, m²) et coût. |

## Interface

Barre d'outils unifiée, barre latérale (visuels et calques), inspecteur à trois onglets (Coupe, Planche, Export), règles en mm, clair/sombre selon le système. Raccourcis proches d'Adobe :

| | |
|---|---|
| ⌘O / ⌘E / ⇧⌘E | Importer / exporter impression + coupe / coupe seule |
| V, H, Espace | Sélection, main, main temporaire |
| ⌘0, ⌘1, ⌘+, ⌘− | Ajuster, taille réelle, zoom (⌥ + molette, pincement) |
| ⌘D, R, ⌫, flèches | Dupliquer, pivoter, retirer, déplacer de 1 mm (⇧ 10 mm) |
| A, ⌘A, Échap | Réorganiser, tout sélectionner, désélectionner |

Les libellés des champs numériques se glissent à la souris pour changer la valeur, comme dans Photoshop.

## Format du PDF exporté

D'après la documentation Mimaki [RasterLink7 – Print & Cut](https://mimaki.com/manual/raster-link7/reference_guide/en-US/1050212235.html) :

- tracés en **couleur d'accompagnement (Separation) nommée `CutContour…`** (préfixe obligatoire, suite en caractères ASCII alphanumériques), trait seul sans fond, 0,25 pt par défaut, surimpression activée ;
- un **calque PDF par nom de coupe**, placé **au-dessus** du calque `Impression` ;
- images **aplaties sur fond blanc, sans transparence** : Mimaki signale que la transparence peut provoquer une double coupe ou une coupe non reconnue ;
- une image par visuel, réutilisée pour chaque exemplaire ;
- deux exports : **impression + coupe**, ou **coupe seule**.

### Dans RasterLink7

1. Ouvrez le PDF : il est reconnu comme travail **Print & Cut**.
2. **Image Edit › Register Mark** : choisissez le type de repères. Gardez au moins la taille recommandée. Sur CJV150, l'écart entre repères doit être d'au moins 2 × leur taille et d'au plus 1000 mm.
3. **Cut Edit** : réglez outil, pression, vitesse et décalage pour chaque nom (`CutContour`, `CutContourHalf`, `CutContourFull`…).

## Limites

- EPS et AI sans compatibilité PDF ne sont pas lus : enregistrez une copie en PDF depuis Illustrator.
- Dans un AI/PDF, seules les 12 premières pages (plans de travail) sont importées. Les formes **remplies** en CutContour sont ignorées (RasterLink coupe les contours).
- Le contour automatique est calculé à partir des pixels (carte de distances puis lissage) : environ 0,05 mm d'erreur en précision « Standard » sur un A4.
- La réserve pour les repères est une marge configurable : CutLink ne dessine pas les repères, c'est RasterLink qui les ajoute.

## Lancer en local

L'application est statique : il suffit de servir le dossier `app/` (les modules ES ne marchent pas en `file://`).

```bash
cd app && python3 -m http.server 8080
# → http://localhost:8080
```

### Bibliothèques

```bash
cd build
npm install
npm run build:libs    # ag-psd + pdf-lib → app/libs.v1.js
npm run build:pdfjs   # pdf.js 4.10.38 → app/vendor/
npm run demo          # régénère app/demo.psd
```

### Test de bout en bout

```bash
pip install playwright && playwright install chromium
cd build && npm run fixtures        # PDF « Illustrator » + SVG de test dans /tmp/cutlink-fx
python3 e2e.py http://localhost:8080/ /tmp/cutlink-fx /tmp
```

Le test charge le PSD d'exemple, ajoute des exemplaires, exporte le PDF et le relit pour vérifier les tracés par nom. Il importe ensuite un PDF avec nuances CutContour (formulaire XObject, Bézier, tracé ouvert, forme remplie) et un SVG, puis vérifie les interactions et l'absence d'erreur JavaScript.

## Structure

```
app/
  index.html        interface
  style.v2.css
  js/app.js         état, planche, inspecteur, rendu, raccourcis, export
  js/engine.js      calques → masque → carte de distances → marching squares → lissage
  js/importers.js   PSD, PDF/AI, SVG, images
  js/pdfcut.js      lecture des flux PDF : récupère et retire les tracés CutContour
  js/pdfout.js      écriture du PDF Print & Cut
  js/util.js        constantes machine, matrices, helpers
  libs.v1.js        ag-psd + pdf-lib regroupés
  vendor/           pdf.js (rendu des PDF/AI)
  demo.psd
build/
  entry.js, mkdemo.js, mkfixtures.js, e2e.py
```

## Licence

MIT. Bibliothèques incluses sous leurs propres licences : [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT), [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), [pdf.js](https://github.com/mozilla/pdf.js) (Apache 2.0).

*Mimaki, RasterLink et CJV150 sont des marques de Mimaki Engineering Co., Ltd. Adobe, Illustrator et Photoshop sont des marques d'Adobe. Canva est une marque de Canva Pty Ltd. Ce projet n'est affilié à aucune de ces sociétés.*
