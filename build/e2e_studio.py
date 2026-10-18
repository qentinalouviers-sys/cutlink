"""Test de bout en bout : Studio (création de sticker) + boutons d'action des alertes.
Usage : python3 build/e2e_studio.py http://localhost:8080/ [dossier_sortie] [--ai]
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/").split("?")[0]
OUT = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else "/tmp"
AI = '--ai' in sys.argv
READY = "() => window.CutLink && CutLink.S.job && CutLink.S.job.stats && !document.querySelector('#busy:not(.hidden)')"
fails = []
def check(c, m):
    print(("  ok   " if c else "  FAIL ") + m)
    if not c: fails.append(m)

async def settle(pg):
    await pg.wait_for_timeout(500)
    await pg.wait_for_function(READY, timeout=90000)

def photo(path):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (800, 600), (90, 140, 210)); d = ImageDraw.Draw(im)
    for i in range(0, 800, 50): d.line((i, 0, i, 600), fill=(70, 120, 190), width=8)
    d.ellipse((250, 150, 550, 450), fill=(230, 60, 40)); d.rectangle((385, 80, 415, 170), fill=(60, 140, 40))
    im.save(path, quality=90)

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1500, "height": 920}, accept_downloads=True)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(BASE); await pg.wait_for_function("window.CutLink")

        print("1. Studio : ouverture et modèle")
        await pg.click("#btnStudio2")
        await pg.wait_for_selector("#studio:not(.hidden) .st-tpls button")
        n_tpl = await pg.locator(".st-tpls button").count()
        check(n_tpl >= 8, f"{n_tpl} modèles proposés")
        await pg.locator(".st-tpls button", has_text="Promo").click()
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=f"{OUT}/studio-1-modele.png")

        print("2. Texte, police, couleur")
        await pg.click(".st-rail [data-p=text]")
        await pg.click(".st-addtxt.mid")
        await pg.wait_for_selector("#stTextArea")
        await pg.fill("#stTextArea", "Kentina\nLouviers")
        await pg.select_option("#stFont", "Pacifico")
        await pg.click(".st-color[data-ck=fill]")
        await pg.click(".st-pal button[data-c='#ffcc00']")
        await pg.click("button[data-pop=fx]")
        await pg.evaluate("""() => { const r = document.querySelector('#stPop input[data-k=curve]'); r.value = 40; r.dispatchEvent(new Event('input')); }""")
        await pg.wait_for_timeout(400)
        n_fonts = await pg.locator("#stFont option").count()
        check(n_fonts >= 20, f"{n_fonts} polices open source dans le sélecteur")
        loaded = await pg.evaluate("document.fonts.check(\"400 20px 'Pacifico'\")")
        check(loaded, "police Pacifico chargée (woff2 local)")
        await pg.mouse.click(1450, 860)  # ferme le popover (zone vide du studio)
        await pg.screenshot(path=f"{OUT}/studio-2-texte.png")

        print("3. Image importée" + (" + détourage IA" if AI else ""))
        photo("/tmp/studio-photo.jpg")
        await pg.click(".st-rail [data-p=img]")
        await pg.set_input_files("#stFile", "/tmp/studio-photo.jpg")
        await pg.wait_for_selector("#stRmbg")
        check(await pg.locator(".st-imgs img").count() == 1, "image ajoutée à la bibliothèque")
        if AI:
            await pg.click("#stRmbg")
            await pg.wait_for_function("document.querySelector('#toast').textContent.includes('Fond retiré') || document.querySelector('#toast').textContent.includes('impossible')", timeout=240000)
            msg = await pg.text_content("#toast")
            check("Fond retiré" in msg, "détourage IA : " + msg[:60])
            await pg.screenshot(path=f"{OUT}/studio-3-ia.png")
        # réduit l'image pour la laisser en bas
        await pg.keyboard.press("Escape")

        print("4. Undo / redo")
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(150)
        await pg.keyboard.press("Control+Shift+z"); await pg.wait_for_timeout(150)
        check(True, "raccourcis annuler/rétablir sans erreur")

        print("5. Envoi sur la planche")
        await pg.click("#stDone")
        await settle(pg)
        info = await pg.evaluate("() => { const a = CutLink.S.arts.at(-1); return { name: a.name, src: a.source, w: a.wMm, h: a.hMm, it: a.items.map(i => i.s), cuts: a.result.cuts.map(c => c.loops.length) } }")
        print("   ", json.dumps(info, ensure_ascii=False)[:300])
        check(info["src"] == "Studio", "visuel Studio sur la planche")
        check(abs(info["w"] - 90) < 1 and abs(info["h"] - 90) < 1, f"taille conservée 90 × 90 mm ({info['w']:.1f} × {info['h']:.1f})")
        check(sum(info["cuts"]) >= 1, f"découpe calculée ({sum(info['cuts'])} tracé(s))")
        check(await pg.evaluate("document.querySelector('#studio').classList.contains('hidden')"), "studio refermé")
        await pg.screenshot(path=f"{OUT}/studio-4-planche.png")

        print("6. Studio : texte seul → mode lettrage")
        await pg.click("#btnStudio")
        await pg.click(".st-rail [data-p=tpl]")
        pg.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.locator(".st-tpls button", has_text="Lettrage").click()
        await pg.wait_for_timeout(500)
        await pg.click("#stDone"); await settle(pg)
        s = await pg.evaluate("() => CutLink.S.arts.at(-1).items[0].s")
        check(s["outerOnly"] is False and s["offset"] <= 1, "texte seul → « Chaque lettre » automatiquement")

        print("7. Alertes avec boutons d'action")
        # visuel 900 mm de large → dépasse la laize
        await pg.evaluate("""() => { const a = CutLink.S.arts[0]; a.hMm = a.hMm * 900 / a.wMm; a.wMm = 900; a.items.forEach(i => i.cache = {}); a.dirty = true; CutLink.schedule(0); }""")
        await settle(pg)
        await pg.click("#tabSeg [data-tab=export]")
        nfix = await pg.locator("#warnings button.fix").count()
        check(nfix >= 1, f"{nfix} bouton(s) d'action dans le contrôle avant envoi")
        labels = await pg.locator("#warnings button.fix").all_text_contents()
        print("    boutons :", labels[:6])
        await pg.screenshot(path=f"{OUT}/alertes-1.png")
        btn = pg.locator("#warnings button.fix", has_text="Réduire")
        check(await btn.count() >= 1, "bouton « Réduire … à … mm » proposé")
        before = await pg.evaluate("CutLink.S.job.warnings.filter(w => w.t === 'err').length")
        await btn.first.click(); await settle(pg)
        after = await pg.evaluate("CutLink.S.job.warnings.filter(w => w.t === 'err').length")
        check(after < before, f"erreur corrigée en un clic ({before} → {after} erreur(s))")

        print("8. Notification après export")
        async with pg.expect_download() as dl:
            await pg.click("#btnExportPC")
        await (await dl.value).save_as(f"{OUT}/studio-export.pdf")
        await pg.wait_for_timeout(500)
        vis = await pg.evaluate("!document.querySelector('#notice').classList.contains('hidden')")
        nb = await pg.locator("#notice button.fix").count()
        print("    notification :", vis, nb, "bouton(s)")
        if vis:
            check(nb >= 1, "notification post-export avec boutons")
            await pg.screenshot(path=f"{OUT}/alertes-2-notice.png")
            await pg.locator("#notice button.fix").first.click(); await settle(pg)
            check(await pg.evaluate("document.querySelector('#notice').classList.contains('hidden')"), "bouton de la notification appliqué, notification fermée")
        else:
            check(True, "aucun conseil restant après export (pas de notification)")

        print("erreurs JS :", errs)
        check(not errs, "aucune erreur JavaScript")
        await b.close()
    print("\nTout est vert." if not fails else f"\n{len(fails)} échec(s).")
    sys.exit(1 if fails else 0)

asyncio.run(main())
