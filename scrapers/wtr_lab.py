# scrapers/wtr_lab.py  v2 — إصلاح paywall + مانع الإعلانات
import asyncio
from difflib import SequenceMatcher
from browser import get_browser_page, human_delay, human_scroll


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


# ═══════════════════════════════════════════════════════════════
# قائمة شاملة: إنجليزي + عربي — أي فقرة تحمل هذه الكلمات تُحذف
# ═══════════════════════════════════════════════════════════════
_PAYWALL_WORDS = [
    # ─── WTR-Lab / نظام ──────────────────────────────────────
    "wtr-lab", "cloudflare", "just a moment", "enable javascript",
    "next chapter", "prev chapter", "table of contents",
    "report chapter", "read more at", "translator:", "editor:",
    # ─── Paywall (إنجليزي) ───────────────────────────────────
    "ai translation requires", "guests can preview",
    "register for free", "sign up to read", "login to continue",
    "ad blocker detected", "disable adblock", "please disable",
    "subscribe to read", "unlock chapter", "premium chapter",
    "disable your ad", "ad-blocker", "adblock",
    # ─── Paywall (عربي) ──────────────────────────────────────
    "تتطلب الترجمة بالذكاء",
    "يمكن للضيوف معاينة",
    "تم اكتشاف مانع",
    "مانع الإعلانات",
    "أداة حظر الإعلانات",
    "يرجى تعطيل",
    "قم بالتسجيل",
    "ترجمة الويب من google",
    "لمواصلة الاستمتاع بالمحتوى",
    "إعلان به مشكلة",
    "يمكنك تعطيل الإعلانات",
    "دعم موقعنا",
    "لدعم موقعنا",
    "الاستمتاع بالمحتوى المجاني",
    "لمواصلة استخدام الترجمة",
]

# ═══════════════════════════════════════════════════════════════
# JS: يُزيل الـ overlays والنوافذ المنبثقة قبل استخراج المحتوى
# ═══════════════════════════════════════════════════════════════
_REMOVE_OVERLAYS_JS = """
() => {
    const selectors = [
        '.modal', '.modal-backdrop', '.overlay',
        '[class*="paywall"]', '[class*="login-wall"]',
        '[class*="register"]',  '[class*="adblock"]',
        '[class*="ad-block"]',  '[class*="popup"]',
        '[class*="subscribe"]', '[class*="premium"]',
        '[class*="unlock"]',    '[class*="blur"]',
        '[role="dialog"]',
    ];
    let n = 0;
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => { el.remove(); n++; });
    }
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    document.querySelectorAll('.chapter-content, .serie-content, #chapter-content')
        .forEach(el => { el.style.filter = 'none'; el.style.maxHeight = ''; });
    return n;
}
"""


# ═══════════════════════════════════════════════════════════════
async def search_novel(novel_name: str) -> dict:
    search_url = f"https://wtr-lab.com/en/novel-finder?text={novel_name.replace(' ', '+')}"

    # block_resources=False — يمنع WTR-Lab من اعتبارنا مانع إعلانات
    async with get_browser_page(search_url, block_resources=False) as page:
        await human_delay(3000, 5000)
        await page.wait_for_load_state("networkidle", timeout=30000)

        title = await page.title()
        print(f"[WTR/search] title: {title}")

        if "just a moment" in title.lower() or "cloudflare" in title.lower():
            await asyncio.sleep(8)
            await page.wait_for_load_state("networkidle", timeout=20000)

        await human_scroll(page, times=3, delay=1.0)
        await asyncio.sleep(1)

        results = await page.evaluate("""
            () => {
                const cards = document.querySelectorAll('a[href*="/novel/"]');
                const seen = new Set();
                const out  = [];
                for (const a of cards) {
                    const href = a.getAttribute('href') || '';
                    const m = href.match(/\\/novel\\/(\\d+)\\/([\\w-]+)/);
                    if (!m) continue;
                    const id = m[1], slug = m[2];
                    if (seen.has(id)) continue;
                    seen.add(id);
                    const titleEl = a.querySelector('h2,h3,.title,.novel-title,.serie-title');
                    const titleTx = titleEl?.innerText?.trim()
                                 || a.innerText?.trim()?.split('\\n')[0] || '';
                    if (!titleTx) continue;
                    out.push({ id, slug, title: titleTx, href });
                }
                return out;
            }
        """)

        print(f"[WTR/search] raw: {[r['title'] for r in results]}")

        if not results:
            raise ValueError(f"لم أجد نتائج لـ '{novel_name}'")

        scored = sorted(results, key=lambda r: _similarity(novel_name, r["title"]), reverse=True)
        best = scored[0]
        print(f"[WTR/search] best: {best['title']} id={best['id']} slug={best['slug']}")

        return {
            "id":        best["id"],
            "slug":      best["slug"],
            "title":     best["title"] or novel_name,
            "novel_url": f"https://wtr-lab.com/en/novel/{best['id']}/{best['slug']}",
        }


# ═══════════════════════════════════════════════════════════════
async def scrape_chapter(novel_id: str, novel_slug: str, chapter_num: int) -> dict:
    candidate_urls = [
        f"https://wtr-lab.com/en/novel/{novel_id}/{novel_slug}/chapter-{chapter_num}",
        f"https://wtr-lab.com/en/serie-en/{novel_id}-{novel_slug}/chapter-{chapter_num}",
        f"https://wtr-lab.com/en/serie/{novel_id}-{novel_slug}/chapter-{chapter_num}",
    ]
    last_error = None
    for url in candidate_urls:
        try:
            print(f"[WTR/chapter] جرب: {url}")
            result = await _fetch_chapter_page(url, chapter_num)
            if result and result.get("paragraphs"):
                print(f"[WTR/chapter] ✅ نجح: {url} ({result['paragraph_count']} فقرة)")
                return result
        except Exception as e:
            print(f"[WTR/chapter] ❌ {url}: {e}")
            last_error = e
    raise ValueError(f"فشل كشط الفصل {chapter_num}: {last_error}")


# ═══════════════════════════════════════════════════════════════
async def _fetch_chapter_page(url: str, chapter_num: int) -> dict:
    # block_resources=False ← السبب الجذري للمشكلة كان هنا
    async with get_browser_page(url, block_resources=False) as page:
        await human_delay(3000, 5000)
        await page.wait_for_load_state("networkidle", timeout=35000)

        page_title = await page.title()
        print(f"[WTR/chapter] title: {page_title}")

        if "just a moment" in page_title.lower() or "cloudflare" in page_title.lower():
            print("[WTR/chapter] Cloudflare — انتظار 8 ثواني")
            await asyncio.sleep(8)
            await page.wait_for_load_state("networkidle", timeout=20000)

        if "404" in page_title or "not found" in page_title.lower():
            raise ValueError("404")

        try:
            await page.wait_for_selector(
                ".chapter-content, .serie-content, #chapter-content, [class*='chapter-content']",
                timeout=12000
            )
        except Exception:
            pass

        await human_scroll(page, times=2, delay=0.8)
        await asyncio.sleep(1.5)

        # ─── المفتاح: أزل الـ overlays قبل استخراج النص ──────────────
        removed = await page.evaluate(_REMOVE_OVERLAYS_JS)
        if removed:
            print(f"[WTR/chapter] 🗑️ أُزيل {removed} overlay/popup")
            await asyncio.sleep(0.5)

        data = await page.evaluate("""
            () => {
                let chapterTitle = '';
                for (const sel of [
                    '.chapter-title', 'h1', '.serie-header h1',
                    '[class*="chapter-title"]'
                ]) {
                    const el = document.querySelector(sel);
                    if (el?.innerText?.trim()) { chapterTitle = el.innerText.trim(); break; }
                }

                let novelTitle = '';
                for (const sel of [
                    '.novel-title', '.serie-title', '[class*="novel-name"]'
                ]) {
                    const el = document.querySelector(sel);
                    if (el?.innerText?.trim()) { novelTitle = el.innerText.trim(); break; }
                }

                let container = null;
                for (const sel of [
                    '.chapter-content', '.serie-content', '#chapter-content',
                    '[class*="chapter-content"]', '[class*="content-text"]',
                    '.reader-content', 'article .content'
                ]) {
                    const el = document.querySelector(sel);
                    if (el) { container = el; break; }
                }
                if (!container) {
                    let maxLen = 0;
                    for (const div of document.querySelectorAll('div')) {
                        const t = div.innerText || '';
                        if (t.length > maxLen && !div.querySelector('nav,header,footer,script')) {
                            maxLen = t.length;
                            if (maxLen > 500) container = div;
                        }
                    }
                }
                if (!container) return { chapterTitle, novelTitle, paragraphs: [], html: '' };

                container.querySelectorAll([
                    'script', 'style', '.ads', '.ad', '[class*="advert"]',
                    'noscript', '.navigation', '.chapter-nav', '[class*="nav"]',
                    '.comment', '[class*="sponsor"]', '.footer', 'button', '.btn',
                    '[class*="paywall"]', '[class*="login"]', '[class*="register"]',
                    '[class*="adblock"]', '[class*="popup"]', '[role="dialog"]',
                    '[class*="unlock"]', '[class*="subscribe"]',
                ].join(',')).forEach(el => el.remove());

                const paragraphs = [];
                const pEls = container.querySelectorAll('p');
                if (pEls.length > 2) {
                    pEls.forEach(p => {
                        const t = p.innerText.trim();
                        if (t.length > 10) paragraphs.push(t);
                    });
                } else {
                    container.innerText.trim().split('\\n').forEach(line => {
                        const t = line.trim();
                        if (t.length > 10) paragraphs.push(t);
                    });
                }

                const html = container.innerHTML.substring(0, 200);
                return { chapterTitle, novelTitle, paragraphs, html };
            }
        """)

        paragraphs = data.get("paragraphs", [])
        print(f"[WTR/chapter] html preview: {data.get('html', '')[:100]}")

        # فلترة شاملة: إنجليزي + عربي + paywall
        clean = [
            p for p in paragraphs
            if not any(w.lower() in p.lower() for w in _PAYWALL_WORDS)
        ]
        print(f"[WTR/chapter] فقرات: {len(paragraphs)} → نظيف: {len(clean)}")

        if len(clean) < 3:
            raise ValueError(
                f"محتوى فارغ أو محمي ({len(clean)} فقرة صالحة)"
            )

        return {
            "title":           data.get("novelTitle") or "رواية",
            "chapter_title":   data.get("chapterTitle") or f"الفصل {chapter_num}",
            "paragraphs":      clean,
            "url":             url,
            "paragraph_count": len(clean),
        }
