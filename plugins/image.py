"""
plugins/image.py
endpoint: POST /image
توليد صور بالذكاء الاصطناعي عبر HuggingFace Inference API (نفس نمط hf.py)
"""

import os
import io
import base64
import logging
from huggingface_hub import InferenceClient
from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

DESCRIPTION = "HuggingFace Inference API — توليد الصور (Text-to-Image)"

HF_TOKEN = os.environ.get("HF_TOKEN", "")

SHORTCUTS: dict[str, str] = {
    "flux":        "black-forest-labs/FLUX.1-schnell",
    "flux-dev":    "black-forest-labs/FLUX.1-dev",
    "sdxl":        "stabilityai/stable-diffusion-xl-base-1.0",
    "sd3":         "stabilityai/stable-diffusion-3-medium-diffusers",
    "sd":          "stabilityai/stable-diffusion-xl-base-1.0",
    "playground":  "playgroundai/playground-v2.5-1024px-aesthetic",
}

DEFAULT_MODEL = "flux"


def resolve_model(name: str) -> str:
    key = (name or DEFAULT_MODEL).lower().strip()
    if key in SHORTCUTS:
        return SHORTCUTS[key]
    if "/" in name:
        return name
    for k, v in SHORTCUTS.items():
        if k.startswith(key) or key in k:
            return v
    return SHORTCUTS[DEFAULT_MODEL]


def generate_image_sync(model_id: str, prompt: str, width: int = 1024, height: int = 1024) -> tuple[str, str]:
    token = HF_TOKEN.strip()
    if not token:
        raise RuntimeError("HF_TOKEN غير موجود — أضفه في Settings → Variables and secrets")

    client = InferenceClient(model=model_id, token=token)

    image = client.text_to_image(
        prompt,
        width=width,
        height=height,
    )

    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=90)
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return img_b64, model_id


def register(app):

    @app.post("/image")
    async def image_endpoint(request: Request):
        import asyncio
        try:
            body      = await request.json()
            prompt    = (body.get("prompt") or "").strip()
            model_raw = body.get("model", DEFAULT_MODEL)
            width     = int(body.get("width", 1024))
            height    = int(body.get("height", 1024))

            if not prompt:
                return JSONResponse({"error": "prompt مطلوب"}, status_code=400)

            model_id = resolve_model(model_raw)
            logger.info(f"[image] {model_raw} → {model_id} | prompt={prompt[:60]}")

            try:
                loop = asyncio.get_event_loop()
                img_b64, model_used = await loop.run_in_executor(
                    None, generate_image_sync, model_id, prompt, width, height
                )
                return JSONResponse({
                    "image_base64": img_b64,
                    "content_type": "image/jpeg",
                    "model_used":   model_used,
                })

            except Exception as e:
                logger.error(f"[image] error: {e}")
                return JSONResponse({"error": str(e), "model_used": model_id}, status_code=503)

        except Exception as e:
            logger.exception(f"[image] Exception: {e}")
            return JSONResponse({"error": str(e)[:200]}, status_code=500)

    @app.get("/image/models")
    async def image_models():
        return JSONResponse({
            "shortcuts": SHORTCUTS,
            "default_model": DEFAULT_MODEL,
        })
