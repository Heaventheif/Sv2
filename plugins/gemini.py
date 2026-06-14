"""
plugins/gemini.py
endpoint: POST /gemini
يستقبل الطلبات من Render ويرسلها لـ Gemini (مع بحث Google حي/Grounding) — مع Groq كـ fallback
"""

import os
import httpx
from fastapi import Request
from fastapi.responses import JSONResponse

# ─── مكتبة Google GenAI الرسمية ──────────────────────────────
from google import genai
from google.genai import types

DESCRIPTION = "Gemini 2.5 Flash (Google Search Grounding) — with Groq fallback"

GEMINI_KEYS = [
    os.environ.get("GEMINI_API_KEY"),
    os.environ.get("GEMINI_API_KEY_2"),
    os.environ.get("GEMINI_API_KEY_3"),
    os.environ.get("GEMINI_API_KEY_4"),
]
GEMINI_KEYS = [k for k in GEMINI_KEYS if k and len(k) > 10]

GROQ_KEY  = os.environ.get("GROQ_API_KEY")
SYSTEM    = 'أنت بوت مساعد ذكي اسمك "Sunken". أجب باللغة العربية بإيجاز (أقل من 200 كلمة). كن ودوداً ومفيداً.'

MODEL_NAME = "gemini-2.5-flash"

# ─── إعداد البحث الحي (Google Search Grounding) ──────────────
GROUNDING_CONFIG = types.GenerateContentConfig(
    system_instruction=SYSTEM,
    temperature=0.7,
    max_output_tokens=1024,
    tools=[types.Tool(google_search=types.GoogleSearch())],
)


def _to_gemini_contents(messages: list) -> list:
    """يحوّل صيغة messages (OpenAI-like) إلى صيغة contents الخاصة بـ Gemini."""
    contents = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue  # system instruction تُمرَّر عبر config، لا داخل contents
        gemini_role = "model" if role == "assistant" else "user"
        contents.append(
            types.Content(role=gemini_role, parts=[types.Part(text=m["content"])])
        )
    return contents


async def _call_gemini(messages: list) -> str:
    """يجرب كل مفاتيح Gemini مع تفعيل البحث الحي (Google Search Grounding)."""
    contents = _to_gemini_contents(messages)

    for key in GEMINI_KEYS:
        try:
            client = genai.Client(api_key=key)

            response = await client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=contents,
                config=GROUNDING_CONFIG,
            )

            reply = (response.text or "").strip()
            if reply:
                return reply

        except Exception as e:
            msg = str(e).lower()
            # تجاوز هذا المفتاح إن تجاوز الحد (rate limit) وجرب التالي
            if "429" in msg or "quota" in msg or "resource_exhausted" in msg:
                continue
            continue

    raise RuntimeError("ALL_GEMINI_KEYS_EXHAUSTED")


async def _call_groq(messages: list) -> str:
    """Fallback: Groq (بدون بحث حي)"""
    if not GROQ_KEY:
        raise RuntimeError("NO_GROQ_KEY")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_KEY}", "Content-Type": "application/json"},
            json={"model": "llama-3.3-70b-versatile", "messages": messages, "max_tokens": 1024, "temperature": 0.7}
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


def register(app):

    @app.post("/gemini")
    async def gemini_endpoint(request: Request):
        """
        Body: { "messages": [{"role": "user", "content": "..."}, ...] }
        Response: { "reply": "...", "provider": "gemini|groq" }
        """
        try:
            body     = await request.json()
            messages = body.get("messages", [])

            if not messages:
                return JSONResponse({"error": "messages مطلوب"}, status_code=400)

            # جرب Gemini أولاً (مع بحث Google الحي)
            try:
                reply = await _call_gemini(messages)
                return JSONResponse({"reply": reply, "provider": "gemini"})
            except Exception:
                # Fallback لـ Groq (نضيف system message هنا فقط، لأن Groq يحتاجه داخل messages)
                try:
                    groq_messages = messages
                    if not any(m.get("role") == "system" for m in groq_messages):
                        groq_messages = [{"role": "system", "content": SYSTEM}] + groq_messages
                    reply = await _call_groq(groq_messages)
                    return JSONResponse({"reply": reply, "provider": "groq"})
                except Exception as e2:
                    return JSONResponse(
                        {"error": f"كل الخوادم فشلت: {str(e2)[:100]}"},
                        status_code=503
                    )

        except Exception as e:
            return JSONResponse({"error": str(e)[:200]}, status_code=500)
