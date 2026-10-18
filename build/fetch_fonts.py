"""Télécharge une sélection de polices Google Fonts (licence OFL / Apache) en woff2, sous-ensemble latin
(couvre le français : accents, œ, €), et génère app/fonts/fonts.css + app/fonts/fonts.json.
Usage : python3 build/fetch_fonts.py
"""
import json, os, re, urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'fonts')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
# (famille, graisses, catégorie affichée)
FONTS = [
    ('Inter', [400, 800], 'Moderne'),
    ('Poppins', [400, 700], 'Moderne'),
    ('Montserrat', [500, 800], 'Moderne'),
    ('Nunito', [400, 800], 'Moderne'),
    ('Fredoka', [400, 700], 'Fun'),
    ('Bebas Neue', [400], 'Impact'),
    ('Anton', [400], 'Impact'),
    ('Archivo Black', [400], 'Impact'),
    ('Oswald', [400, 700], 'Impact'),
    ('Bungee', [400], 'Fun'),
    ('Luckiest Guy', [400], 'Fun'),
    ('Bangers', [400], 'Fun'),
    ('Righteous', [400], 'Fun'),
    ('Playfair Display', [400, 800], 'Élégant'),
    ('DM Serif Display', [400], 'Élégant'),
    ('Abril Fatface', [400], 'Élégant'),
    ('Fraunces', [400, 800], 'Élégant'),
    ('Pacifico', [400], 'Manuscrit'),
    ('Lobster', [400], 'Manuscrit'),
    ('Dancing Script', [400, 700], 'Manuscrit'),
    ('Caveat', [400, 700], 'Manuscrit'),
    ('Permanent Marker', [400], 'Manuscrit'),
    ('Satisfy', [400], 'Manuscrit'),
    ('Space Mono', [400, 700], 'Technique'),
]

def get(url, ua=UA):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': ua}), timeout=60).read()

os.makedirs(OUT, exist_ok=True)
css, meta = [], []
for fam, weights, cat in FONTS:
    q = fam.replace(' ', '+') + ':wght@' + ';'.join(map(str, weights))
    text = get(f'https://fonts.googleapis.com/css2?family={q}&display=swap').decode()
    got = []
    # blocs @font-face précédés d'un commentaire /* subset */ : on ne garde que « latin »
    for sub, block in re.findall(r'/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]*})', text):
        if sub != 'latin':
            continue
        w = int(re.search(r'font-weight:\s*(\d+)', block).group(1))
        url = re.search(r'url\((https://[^)]+\.woff2)\)', block).group(1)
        fn = f"{re.sub(r'[^a-z0-9]+', '-', fam.lower()).strip('-')}-{w}.woff2"
        with open(os.path.join(OUT, fn), 'wb') as f:
            f.write(get(url))
        rng = re.search(r'unicode-range:\s*([^;]+);', block).group(1)
        css.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:swap;src:url({fn}) format('woff2');unicode-range:{rng};}}")
        got.append(w)
    meta.append({'family': fam, 'weights': sorted(set(got)), 'cat': cat})
    print(f'{fam:20s} {sorted(set(got))}')

with open(os.path.join(OUT, 'fonts.css'), 'w') as f:
    f.write('/* Polices Google Fonts (SIL Open Font License 1.1 / Apache 2.0), sous-ensemble latin. */\n' + '\n'.join(css) + '\n')
with open(os.path.join(OUT, 'fonts.json'), 'w') as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
