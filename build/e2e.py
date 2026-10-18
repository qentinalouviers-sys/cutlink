"""Test de bout en bout CutLink (Playwright).

Usage : python3 build/e2e.py http://localhost:8080/ [dossier_fixtures] [dossier_sortie]
Les fixtures sont générées par `node build/mkfixtures.js <dossier>`.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/").split("?")[0]
FX = sys.argv[2] if len(sys.argv) > 2 else "/tmp/cutlink-fx"
OUT = sys.argv[3] if len(sys.argv) > 3 else "/tmp"
EXE = "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None

READY = "() => window.CutLink && CutLink.S.job && CutLink.S.job.stats && !document.querySelector('#busy:not(.hidden)')"
fails = []
def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond: fails.append(msg)

async def settle(pg):
    await pg.wait_for_timeout(400)
    await pg.wait_for_function(READY, timeout=60000)

async def main():
    async with async_playwright() as p:
        kw = {"executable_path": EXE} if EXE else {}
        b = await p.chromium.launch(**kw)
        pg = await b.new_page(viewport={"width": 1500, "height": 920}, accept_downloads=True, device_scale_factor=1)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))

        print("1. PSD d'exemple")
        await pg.goto(BASE + "?demo")
        await settle(pg)
        info = await pg.evaluate("""() => { const S = CutLink.S, a = S.arts[0]; return {
          art: [a.wMm, a.hMm], items: a.items.map(i => [i.name, i.s.cut, i.tags, i.stat && i.stat.pieces]),
          stats: S.job.stats, warn: S.job.warnings.map(w => w.t + ': ' + w.m) } }""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        check(abs(info["art"][0] - 150) < 0.5, "taille lue dans le PSD (150 mm)")
        check(info["stats"]["pieces"] >= 6, "au moins 6 tracés")
        check(not [w for w in info["warn"] if w.startswith("err")], "aucune erreur")
        await pg.screenshot(path=f"{OUT}/cutlink-1-demo.png")

        print("2. Réglages, exemplaires, export")
        await pg.evaluate("""() => { const S = CutLink.S, a = S.arts[0]; const b = a.items.find(i => i.name.startsWith('Badge'));
          b.s.shape = 'rrect'; b.s.name = 'CutContourHalf'; b.s.offset = 3; a.dirty = true; S.out.frame = true; S.out.bleed = 1; }""")
        await pg.click("#cPlus"); await pg.click("#cPlus"); await pg.click("#cPlus")
        await settle(pg)
        job = await pg.evaluate("""() => { const j = CutLink.S.job; return { stats: j.stats, n: CutLink.S.places.length,
          rot: CutLink.S.places.map(p => p.rot), bbox: j.bbox, warn: j.warnings.map(w => w.t + ': ' + w.m) } }""")
        print(json.dumps(job, ensure_ascii=False))
        check(job["n"] == 4, "4 exemplaires sur la planche")
        check(job["stats"]["jobW"] <= 770 + 0.01, "le travail tient dans la zone utile (800 − 2×15 mm)")
        check(not [w for w in job["warn"] if w.startswith("err")], "pas de chevauchement ni d'erreur")
        await pg.click("[data-tab=export]")
        async with pg.expect_download() as dl:
            await pg.click("#btnExportPC")
        d = await dl.value
        await d.save_as(f"{OUT}/cutlink-export.pdf")
        print("   téléchargé :", d.suggested_filename)
        rt = await pg.evaluate("""async () => {
          const doc = await window.Lib.PDFLib.PDFDocument.load(CutLink.S.lastPdf);
          const [pg] = CutLink.extractCuts(doc);
          const exp = {}; for (const p of CutLink.S.job.places) for (const c of p.art.result.cuts) exp[c.name] = (exp[c.name] || 0) + c.loops.length;
          if (CutLink.S.job.frame) exp[CutLink.S.job.frame.name] = (exp[CutLink.S.job.frame.name] || 0) + 1;
          const got = {}; for (const [n, l] of pg.cuts) got[n] = l.length;
          return { exp, got, size: [pg.wMm, pg.hMm], job: [CutLink.S.job.stats.jobW, CutLink.S.job.stats.jobH] } }""")
        print("  ", json.dumps(rt))
        check(rt["exp"] == rt["got"], "le PDF exporté relu contient exactement les tracés attendus par nom")
        check(abs(rt["size"][0] - rt["job"][0]) < 0.2 and abs(rt["size"][1] - rt["job"][1]) < 0.2, "taille de page = taille du travail")
        await pg.screenshot(path=f"{OUT}/cutlink-2-planche.png")

        print("3. Import PDF « Illustrator » + SVG")
        await pg.goto(BASE)
        await pg.set_input_files("#fileInput", [f"{FX}/illustrator-like.pdf", f"{FX}/badge.svg"])
        await settle(pg)
        r = await pg.evaluate("""() => { const S = CutLink.S; return S.arts.map(a => ({
          name: a.name, size: [a.wMm, a.hMm], fill: a.fillCuts || 0,
          items: a.items.map(i => ({ n: i.name, cut: i.s.cut, name: i.s.name, vec: i.vector ? i.vector.loops.map(l => [l.length, !!l.open]) : null })),
          pieces: a.result.pieces, pb: a.result.pb, warn: S.job.warnings.map(w => w.t + ': ' + w.m) })) }""")
        print(json.dumps(r, ensure_ascii=False, indent=1))
        pdf = r[0]
        check(abs(pdf["size"][0] - 100) < 0.1 and abs(pdf["size"][1] - 80) < 0.1, "PDF : 100 × 80 mm")
        vec = {i["name"]: i["vec"] for i in pdf["items"] if i["vec"]}
        check("CutContour" in vec and len(vec["CutContour"]) == 1 and not vec["CutContour"][0][1], "CutContour : 1 tracé fermé repris (formulaire XObject)")
        check("CutContourHalf" in vec and vec["CutContourHalf"][0][1], "CutContourHalf : tracé ouvert conservé ouvert")
        check(pdf["fill"] == 1, "remplissage CutContour détecté et ignoré")
        check(not [i for i in pdf["items"] if not i["vec"] and i["cut"]], "contour auto désactivé quand le fichier a ses propres coupes")
        # le trait de coupe ne doit pas apparaître dans l'image imprimée : pixel sur le cercle r=25 mm, à (75, 40) mm
        px = await pg.evaluate("""() => { const a = CutLink.S.arts[0], k = a.wPx / a.wMm; const x = a.composite.getContext('2d');
          const d = x.getImageData(Math.round(75 * k), Math.round(40 * k), 1, 1).data; const e = x.getImageData(Math.round(50 * k), Math.round(40 * k), 1, 1).data;
          return { ring: [...d], disk: [...e] } }""")
        print("  ", px)
        check(px["ring"][3] < 10, "aucun trait magenta imprimé à l'emplacement de la coupe")
        check(px["disk"][0] > 180 and px["disk"][3] > 250, "le disque rouge est bien rendu")
        svg = r[1]
        check(abs(svg["size"][0] - 60) < 0.1 and abs(svg["size"][1] - 40) < 0.1, "SVG : 60 × 40 mm")
        check(svg["pieces"] >= 1, "SVG : contour calculé")
        await pg.screenshot(path=f"{OUT}/cutlink-3-pdf-svg.png")

        print("4. Interactions : sélection, rotation, raccourcis")
        await pg.evaluate("() => { CutLink.S.selPlaces = new Set([CutLink.S.places[0].id]); }")
        await pg.keyboard.press("r")
        await pg.wait_for_timeout(300)
        rot = await pg.evaluate("() => [CutLink.S.places[0].rot, CutLink.S.sheet.auto]")
        check(rot == [90, False], "R pivote et désactive la disposition auto")
        await pg.keyboard.press("a")
        await pg.wait_for_timeout(300)
        ov = await pg.evaluate("() => CutLink.S.job.warnings.filter(w => w.t === 'err').length")
        check(ov == 0, "réorganisation sans erreur")
        await pg.click("#btnHelp"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f"{OUT}/cutlink-4-aide.png")
        await pg.keyboard.press("Escape")

        print("5. Thème sombre")
        await pg.emulate_media(color_scheme="dark")
        await pg.goto(BASE + "?demo"); await settle(pg)
        await pg.click("[data-tab=sheet]")
        await pg.screenshot(path=f"{OUT}/cutlink-5-dark.png")

        print("erreurs JS :", errs)
        check(not errs, "aucune erreur JavaScript")
        await b.close()
    print("\n" + ("ÉCHECS : " + str(len(fails)) if fails else "Tout est vert."))
    sys.exit(1 if fails else 0)

asyncio.run(main())
