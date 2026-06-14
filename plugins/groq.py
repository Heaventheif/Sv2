"""
plugins/groq.py
endpoint: POST /groq
يدعم: نص + صور (Vision) + صوت (Whisper) + فيديو (frames)
النموذج الرئيسي: meta-llama/llama-4-scout-17b-16e-instruct
Fallback: Gemini 2.0 Flash
"""

import os, base64, httpx, asyncio
from fastapi import Request
from fastapi.responses import JSONResponse

DESCRIPTION = "Llama 4 Scout — Vision + Audio + Video + Gemini fallback"

GROQ_KEY = os.environ.get("GROQ_API_KEY")
GEMINI_KEYS = [k for k in [
    os.environ.get("GEMINI_API_KEY"),
    os.environ.get("GEMINI_API_KEY_2"),
    os.environ.get("GEMINI_API_KEY_3"),
    os.environ.get("GEMINI_API_KEY_4"),
] if k and len(k) > 10]

LLAMA4_MODEL  = "meta-llama/llama-4-scout-17b-16e-instruct"
WHISPER_MODEL = "whisper-large-v3"

SYSTEM = (
    'أنت بوت مساعد ذكي اسمك "Sunken". '
    'أجب دائماً باللغة العربية بإيجاز (أقل من 300 كلمة). '
    'كن ودوداً ومهذباً. إذا أُرسلت إليك صورة أو صوت أو فيديو فحللها بدقة.'
)

# ─── تحميل ملف من URL وتحويله base64 ────────────────────────
async def _fetch_base64(url: str) -> tuple[bytes, str]:
    """يُرجع (raw_bytes, base64_string)"""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        raw = r.content
        return raw, base64.b64encode(raw).decode()

def _guess_mime(url: str, raw: bytes) -> str:
    """يخمن نوع الملف من الـ URL أو magic bytes"""
    url_low = url.lower().split("?")[0]
    if url_low.endswith(".png"):  return "image/png"
    if url_low.endswith(".gif"):  return "image/gif"
    if url_low.endswith(".webp"): return "image/webp"
    if url_low.endswith(".mp3"):  return "audio/mp3"
    if url_low.endswith(".m4a"):  return "audio/mp4"
    if url_low.endswith(".ogg"):  return "audio/ogg"
    if url_low.endswith(".wav"):  return "audio/wav"
    if url_low.endswith(".mp4"):  return "video/mp4"
    # magic bytes
    if raw[:4] == b'\x89PNG': return "image/png"
    if raw[:3] == b'GIF':     return "image/gif"
    if raw[:2] in (b'\xff\xd8',): return "image/jpeg"
    if raw[:4] == b'RIFF':    return "audio/wav"
    if raw[:3] == b'ID3':     return "audio/mp3"
    return "image/jpeg"  # default

# ─── Groq: نص فقط ────────────────────────────────────────────
async def _groq_text(messages: list) -> str:
    if not GROQ_KEY:
        raise RuntimeError("NO_GROQ_KEY")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            json={
                "model": LLAMA4_MODEL,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": 0.7,
            }
        )
        r.raise_for_status()
        reply = r.json()["choices"][0]["message"]["content"]
        if not reply: raise RuntimeError("EMPTY")
        return reply

# ─── Groq: Vision (صورة + نص) ────────────────────────────────
async def _groq_vision(messages: list, img_b64: str, mime: str) -> str:
    if not GROQ_KEY:
        raise RuntimeError("NO_GROQ_KEY")

    # استبدل آخر رسالة user بمحتوى multipart
    groq_msgs = []
    for i, m in enumerate(messages):
        if i == len(messages) - 1 and m["role"] == "user":
            text = m["content"] if isinstance(m["content"], str) else ""
            groq_msgs.append({
                "role": "user",
                "content": [
                    {"type": "text",      "text": text or "وصف هذه الصورة"},
                    {"type": "image_url", "image_url": {
                        "url": f"data:{mime};base64,{img_b64}"
                    }},
                ],
            })
        else:
            groq_msgs.append(m)

    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            json={
                "model": LLAMA4_MODEL,
                "messages": groq_msgs,
                "max_tokens": 1024,
            }
        )
        r.raise_for_status()
        reply = r.json()["choices"][0]["message"]["content"]
        if not reply: raise RuntimeError("EMPTY")
        return reply

# ─── Groq: Whisper للصوت ─────────────────────────────────────
async def _groq_audio(audio_raw: bytes, mime: str, prompt: str) -> str:
    if not GROQ_KEY:
        raise RuntimeError("NO_GROQ_KEY")

    ext_map = {
        "audio/mp3": "mp3", "audio/mpeg": "mp3",
        "audio/mp4": "m4a", "audio/m4a": "m4a",
        "audio/ogg": "ogg", "audio/wav": "wav",
        "audio/webm": "webm", "audio/flac": "flac",
    }
    ext = ext_map.get(mime, "mp3")
    fname = f"audio.{ext}"

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_KEY}"},
            files={"file": (fname, audio_raw, mime)},
            data={"model": WHISPER_MODEL, "language": "ar", "response_format": "text"},
        )
        r.raise_for_status()
        transcription = r.text.strip()
        if not transcription:
            raise RuntimeError("EMPTY_TRANSCRIPTION")

    # بعد النسخ نرسل للنموذج النصي
    follow_up = prompt.strip() or "لخص ما قيل في هذا الصوت"
    text_msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user",   "content": f"[تفريغ الصوت]: {transcription}\n\nالسؤال: {follow_up}"},
    ]
    reply = await _groq_text(text_msgs)
    return f"🎵 التفريغ:\n{transcription}\n\n💬 الرد:\n{reply}"

# ─── معالجة الفيديو: استخرج frame أول كصورة ─────────────────
# HF لديه RAM كافي — نستخدم ffmpeg إن توفر، وإلا نعامله كصورة
async def _process_video(url: str, prompt: str, messages: list) -> str:
    try:
        import subprocess, tempfile, os as _os

        raw, _ = await _fetch_base64(url)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(raw)
            vid_path = f.name

        frame_path = vid_path.replace(".mp4", "_frame.jpg")
        proc = subprocess.run(
            ["ffmpeg", "-i", vid_path, "-ss", "00:00:01", "-vframes", "1",
             "-q:v", "2", frame_path, "-y"],
            capture_output=True, timeout=30
        )
        _os.unlink(vid_path)

        if proc.returncode != 0 or not _os.path.exists(frame_path):
            raise RuntimeError("ffmpeg failed")

        with open(frame_path, "rb") as f:
            frame_raw = f.read()
        _os.unlink(frame_path)

        frame_b64 = base64.b64encode(frame_raw).decode()
        reply = await _groq_vision(messages, frame_b64, "image/jpeg")
        return f"🎬 تحليل الفيديو (الإطار الأول):\n{reply}"

    except Exception as e:
        # Fallback: أخبر المستخدم
        return f"⚠️ تعذّر تحليل الفيديو مباشرة ({str(e)[:60]}). يمكنك أخذ screenshot وإرساله كصورة."

# ─── Gemini Fallback ─────────────────────────────────────────
async def _gemini_fallback(messages: list) -> str:
    contents = []
    for m in messages:
        if m["role"] == "system": continue
        role = "model" if m["role"] == "assistant" else "user"
        content = m["content"] if isinstance(m["content"], str) else str(m.get("content",""))
        contents.append({"role": role, "parts": [{"text": content}]})

    async with httpx.AsyncClient(timeout=25) as c:
        for key in GEMINI_KEYS:
            try:
                r = await c.post(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
                    headers={"Content-Type": "application/json", "X-goog-api-key": key},
                    json={
                        "systemInstruction": {"parts": [{"text": SYSTEM}]},
                        "contents": contents,
                        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024},
                    }
                )
                if r.status_code == 429: continue
                r.raise_for_status()
                reply = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                if reply: return reply
            except Exception:
                continue
    raise RuntimeError("ALL_GEMINI_EXHAUSTED")


# ─── register ────────────────────────────────────────────────
def register(app):

    @app.post("/groq")
    async def groq_endpoint(request: Request):
        """
        Body:
          {
            "messages": [{"role":"user","content":"..."}, ...],
            // الرسالة الأخيرة قد تحمل:
            // "attachment": {"kind": "image|audio|video", "url": "..."}
          }
        Response: {"reply": "...", "provider": "groq|gemini"}
        """
        try:
            body     = await request.json()
            messages = body.get("messages", [])

            if not messages:
                return JSONResponse({"error": "messages مطلوب"}, status_code=400)

            # أضف system prompt إن غاب
            if not any(m.get("role") == "system" for m in messages):
                messages = [{"role": "system", "content": SYSTEM}] + messages

            # كشف المرفق من آخر رسالة
            last = messages[-1]
            attachment = last.pop("attachment", None)  # نزيله من الرسالة الأصلية
            kind = attachment.get("kind") if attachment else None
            att_url = attachment.get("url") if attachment else None
            prompt = last.get("content", "") if isinstance(last.get("content"), str) else ""

            # ─── معالجة حسب النوع ────────────────────────────
            try:
                if kind == "image":
                    # ✅ Render يحمّل الصورة ويرسل base64 مباشرة (مثل gptx)
                    b64  = attachment.get("base64")
                    mime = attachment.get("contentType", "image/jpeg")
                    # fallback: لو أُرسل URL بدل base64
                    if not b64 and att_url:
                        raw, b64 = await _fetch_base64(att_url)
                        mime = _guess_mime(att_url, raw)
                    if not b64:
                        return JSONResponse({"error": "لم يُرسل base64 أو URL للصورة"}, status_code=400)
                    reply = await _groq_vision(messages, b64, mime)
                    return JSONResponse({"reply": reply, "provider": "groq-vision"})

                elif kind == "audio" and att_url:
                    raw, _ = await _fetch_base64(att_url)
                    mime = _guess_mime(att_url, raw)
                    reply = await _groq_audio(raw, mime, prompt)
                    return JSONResponse({"reply": reply, "provider": "groq-whisper"})

                elif kind == "video" and att_url:
                    reply = await _process_video(att_url, prompt, messages)
                    return JSONResponse({"reply": reply, "provider": "groq-video"})

                else:
                    # نص فقط
                    try:
                        reply = await _groq_text(messages)
                        return JSONResponse({"reply": reply, "provider": "groq"})
                    except Exception:
                        reply = await _gemini_fallback(messages)
                        return JSONResponse({"reply": reply, "provider": "gemini"})

            except Exception as e:
                # Fallback عام لـ Gemini (للنص فقط)
                try:
                    reply = await _gemini_fallback(messages)
                    return JSONResponse({"reply": reply, "provider": "gemini-fallback"})
                except Exception as e2:
                    return JSONResponse(
                        {"error": f"كل الخوادم فشلت: {str(e2)[:100]}"},
                        status_code=503
                    )

        except Exception as e:
            return JSONResponse({"error": str(e)[:200]}, status_code=500)
