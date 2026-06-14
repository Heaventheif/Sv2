"""
plugins/novel.py
روايات WTR-Lab — بحث وجلب فصول
"""
import time
import traceback
from fastapi import Query
from fastapi.responses import JSONResponse
from scrapers.wtr_lab import search_novel, scrape_chapter

DESCRIPTION     = "روايات WTR-Lab: بحث وجلب الفصول"
DOCKERFILE_DEPS = []


def register(app):

    @app.get("/novel/search", tags=["novel"])
    async def novel_search(q: str = Query(...)):
        try:
            return JSONResponse({"success": True, "data": await search_novel(q)})
        except Exception as e:
            err = traceback.format_exc()
            print(f"[NOVEL/search] ❌\n{err}")
            return JSONResponse({"success": False, "error": str(e), "trace": err[-500:]}, status_code=500)

    @app.get("/novel/chapter", tags=["novel"])
    async def novel_chapter(id: str = Query(...), slug: str = Query(...), chapter: int = Query(...)):
        start = time.time()
        try:
            result = await scrape_chapter(id, slug, chapter)
            return JSONResponse({"success": True,
                                 "elapsed_seconds": round(time.time() - start, 2),
                                 "data": result})
        except Exception as e:
            err = traceback.format_exc()
            print(f"[NOVEL/chapter] ❌\n{err}")
            return JSONResponse({"success": False,
                                 "elapsed_seconds": round(time.time() - start, 2),
                                 "error": str(e), "trace": err[-500:]}, status_code=500)

    @app.get("/novel/fetch", tags=["novel"])
    async def novel_fetch(name: str = Query(...), chapter: int = Query(...)):
        start = time.time()
        try:
            print(f"[NOVEL/fetch] 🔍 {name} فصل {chapter}")
            info = await search_novel(name)
            print(f"[NOVEL/fetch] ✅ وجد: {info['title']} ({info['id']})")
            ch   = await scrape_chapter(info["id"], info["slug"], chapter)
            print(f"[NOVEL/fetch] ✅ فصل {chapter}: {ch['paragraph_count']} فقرة")
            return JSONResponse({
                "success":         True,
                "elapsed_seconds": round(time.time() - start, 2),
                "novel":   {"id": info["id"], "slug": info["slug"],
                            "title": info["title"], "url": info["novel_url"]},
                "chapter": {"number": chapter, "title": ch["chapter_title"],
                            "paragraphs": ch["paragraphs"],
                            "paragraph_count": ch["paragraph_count"],
                            "url": ch["url"]},
            })
        except Exception as e:
            err = traceback.format_exc()
            print(f"[NOVEL/fetch] ❌\n{err}")
            return JSONResponse({"success": False,
                                 "elapsed_seconds": round(time.time() - start, 2),
                                 "error": str(e), "trace": err[-800:]}, status_code=500)
