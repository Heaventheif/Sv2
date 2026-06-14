"""
plugins/hf.py
endpoint: POST /hf
يدعم النصوص + الصور (base64 vision)
"""

import os
import logging
import re
from huggingface_hub import InferenceClient
from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

DESCRIPTION = "HuggingFace Inference API — نصوص + صور"

HF_TOKEN = os.environ.get("HF_TOKEN", "")

SHORTCUTS: dict[str, str] = {
    "qwen":      "Qwen/Qwen2.5-72B-Instruct",
    "qwen72":    "Qwen/Qwen2.5-72B-Instruct",
    "qwen7":     "Qwen/Qwen2.5-7B-Instruct",
    "qwen3":     "Qwen/Qwen3-235B-A22B",
    "llama":     "meta-llama/Llama-3.1-8B-Instruct",
    "llama70":   "meta-llama/Llama-3.3-70B-Instruct",
    "llama8":    "meta-llama/Llama-3.1-8B-Instruct",
    "llama4":    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "mistral":   "mistralai/Mistral-7B-Instruct-v0.3",
    "mistral22": "mistralai/Mistral-Small-3.1-22B-Instruct-2503",
    "mixtral":   "mistralai/Mixtral-8x7B-Instruct-v0.1",
    "deepseek":  "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    "deepseek7": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    "phi":       "microsoft/Phi-3.5-mini-instruct",
    "phi4":      "microsoft/phi-4",
    "gemma":     "google/gemma-3-27b-it",
    "gemma4":    "google/gemma-3-4b-it",
    "zephyr":    "HuggingFaceH4/zephyr-7b-beta",
    "command":   "CohereForAI/c4ai-command-r-plus-08-2024",
}

VISION_FALLBACK = "meta-llama/Llama-4-Scout-17B-16E-Instruct"

VISION_MODELS = {
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "google/gemma-3-27b-it",
    "google/gemma-3-4b-it",
    "mistralai/Mistral-Small-3.1-22B-Instruct-2503",
}

SYSTEM_PROMPT = (
    'أنت بوت مساعد ذكي اسمك "Sunken". '
    'أجب دائماً باللغة العربية بإيجاز (أقل من 300 كلمة). '
    'كن ودوداً ومهذباً. '
    'لا تكتب أي تفكير أو تحليل داخلي، اكتب الجواب النهائي فقط مباشرة.'
)


def resolve_model(name: str) -> str:
    key = name.lower().strip()
    if key in SHORTCUTS:
        return SHORTCUTS[key]
    if "/" in name:
        return name
    for k, v in SHORTCUTS.items():
        if k.startswith(key) or key in k:
            return v
    return name


def clean_reply(text: str) -> str:
    """
    إزالة كل أنماط التفكير والتحليل الداخلي:
    - <think>...</think>
    - <thinking>...</thinking>
    - <analysis>...</analysis>
    - أي نص قبل الجواب الحقيقي يبدأ بـ "الجواب:" أو "Answer:" إذا وُجد
    """
    # حذف وسوم التفكير
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<thinking>[\s\S]*?</thinking>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<analysis>[\s\S]*?</analysis>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<reflection>[\s\S]*?</reflection>", "", text, flags=re.IGNORECASE)

    # إذا فيه "الجواب:" أو "Answer:" → خذ ما بعده فقط
    match = re.search(r"(?:الجواب|الإجابة|Answer)\s*:\s*", text, flags=re.IGNORECASE)
    if match:
        text = text[match.end():]

    return text.strip()


def has_image(messages: list) -> bool:
    return any(
        m.get("attachment", {}).get("kind") == "image" and m.get("attachment", {}).get("base64")
        for m in messages
    )


def build_messages(raw_messages: list, model_id: str) -> list:
    result = []

    if not any(m.get("role") == "system" for m in raw_messages):
        result.append({"role": "system", "content": SYSTEM_PROMPT})

    for msg in raw_messages:
        role = msg.get("role", "user")
        text = msg.get("content", "")
        att  = msg.get("attachment")

        if att and att.get("kind") == "image" and att.get("base64"):
            if model_id in VISION_MODELS:
                content = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{att['contentType']};base64,{att['base64']}"
                        }
                    },
                    {"type": "text", "text": text or "وصف هذه الصورة"},
                ]
            else:
                content = f"[المستخدم أرسل صورة] {text or 'وصف هذه الصورة'}"
        else:
            content = text

        result.append({"role": role, "content": content})

    return result


def call_hf_sync(model_id: str, messages: list, max_tokens: int = 512) -> tuple[str, str]:
    token = HF_TOKEN.strip()
    if not token:
        raise RuntimeError("HF_TOKEN غير موجود — أضفه في Settings → Variables and secrets")

    actual_model = model_id
    if has_image(messages) and model_id not in VISION_MODELS:
        logger.warning(f"[hf] {model_id} لا يدعم Vision → تحويل لـ {VISION_FALLBACK}")
        actual_model = VISION_FALLBACK

    client = InferenceClient(model=actual_model, token=token)
    built  = build_messages(messages, actual_model)

    result = client.chat_completion(
        messages=built,
        max_tokens=max_tokens,
        temperature=0.7,
    )

    reply = clean_reply(result.choices[0].message.content or "")
    if not reply:
        raise RuntimeError("استجابة فارغة من النموذج")
    return reply, actual_model


def register(app):

    @app.post("/hf")
    async def hf_endpoint(request: Request):
        import asyncio
        try:
            body       = await request.json()
            model_raw  = body.get("model", "llama4")
            messages   = body.get("messages", [])
            max_tokens = int(body.get("max_tokens", 512))

            if not messages:
                return JSONResponse({"error": "messages مطلوب"}, status_code=400)

            model_id = resolve_model(model_raw)
            logger.info(f"[hf] {model_raw} → {model_id} | has_image={has_image(messages)}")

            try:
                loop = asyncio.get_event_loop()
                reply, model_used = await loop.run_in_executor(
                    None, call_hf_sync, model_id, messages, max_tokens
                )
                return JSONResponse({"reply": reply, "model_used": model_used})

            except Exception as e:
                logger.error(f"[hf] error: {e}")
                return JSONResponse({"error": str(e), "model_used": model_id}, status_code=503)

        except Exception as e:
            logger.exception(f"[hf] Exception: {e}")
            return JSONResponse({"error": str(e)[:200]}, status_code=500)

    @app.get("/hf/models")
    async def hf_models():
        return JSONResponse({
            "shortcuts": SHORTCUTS,
            "vision_models": list(VISION_MODELS),
            "vision_fallback": VISION_FALLBACK,
            "default_model": "llama4",
        })
