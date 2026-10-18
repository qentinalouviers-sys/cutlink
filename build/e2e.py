import asyncio, sys, json
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/?demo"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1500, "height": 900}, accept_downloads=True)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto(URL)
        await pg.wait_for_function("window.CutLink && CutLink.S.result && CutLink.S.result.cuts", timeout=60000)
        await pg.wait_for_timeout(1500)
        info = await pg.evaluate("""() => { const S = CutLink.S; return {
          doc: [S.doc.wMm, S.doc.hMm], items: S.items.map(i => [i.name, i.s.cut, i.tags, i.stat && i.stat.pieces]),
          stats: S.result.stats, warn: S.result.warnings.map(w => w.t + ': ' + w.m) } }""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        await pg.screenshot(path="/tmp/cut1.png")
        # rectangle arrondi sur le badge + cadre + fond perdu
        await pg.evaluate("""() => { const S = CutLink.S; const b = S.items.find(i => i.name.startsWith('Badge')); b.s.shape='rrect'; b.s.name='CutContourHalf'; b.s.offset=3; }""")
        await pg.check("#gFrame"); await pg.fill("#gBleed", "1"); await pg.dispatch_event("#gBleed", "change")
        await pg.wait_for_timeout(2500)
        async with pg.expect_download() as dl:
            await pg.click("#btnExport")
        d = await dl.value
        await d.save_as("/tmp/cut_test.pdf")
        print("download:", d.suggested_filename)
        await pg.screenshot(path="/tmp/cut2.png")
        print("errors:", errs)
        await b.close()
asyncio.run(main())

async def jpg():
    from PIL import Image, ImageDraw  # JPG de test sur fond blanc (détourage auto)
    im = Image.new('RGB', (1200, 800), 'white'); d = ImageDraw.Draw(im)
    d.ellipse((100, 100, 500, 500), fill=(200, 30, 30)); d.polygon([(700, 100), (1100, 400), (700, 700)], fill=(30, 30, 200))
    im.save('/tmp/test.jpg', dpi=(150, 150), quality=92)
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width":1500,"height":900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto(URL.split("?")[0])
        await pg.set_input_files("#fileInput", "/tmp/test.jpg")
        await pg.wait_for_function("CutLink.S.result && CutLink.S.result.stats", timeout=60000)
        await pg.wait_for_timeout(800)
        print(json.dumps(await pg.evaluate("() => ({doc:[CutLink.S.doc.wMm,CutLink.S.doc.hMm], it:CutLink.S.items.map(i=>[i.name,i.tags,i.stat]), st:CutLink.S.result.stats, w:CutLink.S.result.warnings.map(w=>w.m)})"), ensure_ascii=False))
        await pg.screenshot(path="/tmp/cut3.png"); print("errors:", errs); await b.close()
asyncio.run(jpg())
