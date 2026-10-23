# Kopor Krio listener: speech to text for Krio (also Mende, Temne and 1,600+ other languages) with Meta's
# Omnilingual ASR (Apache 2.0, free for commercial use). Meta reports a 0.4% character error rate for Krio.
# Runs on a free Hugging Face Space (CPU). Kopor's server sends a short 16 kHz WAV recording and gets the words back.
# Only Kopor's server can use it: every request needs the shared key (Space secret KRIO_KEY).
import hmac
import os
import tempfile
import time

from fastapi import FastAPI, Header, HTTPException, Request
from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline

MODEL = os.environ.get("OMNI_MODEL", "omniASR_CTC_1B_v2")  # fast on CPU; LLM models are more accurate but much slower
KEY = os.environ.get("KRIO_KEY", "")
MAX_BYTES = 1_300_000  # about 40 seconds of 16 kHz mono WAV (the model's limit)
LANGS = {"kri": "kri_Latn", "men": "men_Latn", "tem": "tem_Latn", "en": "eng_Latn"}

pipeline = ASRInferencePipeline(model_card=MODEL)
app = FastAPI(title="Kopor Krio listener", docs_url=None, redoc_url=None)


@app.get("/")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
async def transcribe(request: Request, x_krio_key: str = Header(default=""), lang: str = "kri"):
    if not KEY or not hmac.compare_digest(x_krio_key, KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")
    raw = await request.body()
    if len(raw) < 1000 or len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Send a WAV recording of up to 40 seconds")
    started = time.time()
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        f.write(raw)
        f.flush()
        # CTC models hear any language; LLM models are told which one to expect.
        kwargs = {"lang": [LANGS.get(lang, "kri_Latn")]} if "LLM" in MODEL else {}
        try:
            text = pipeline.transcribe([f.name], batch_size=1, **kwargs)[0]
        except Exception as e:  # unreadable audio
            raise HTTPException(status_code=400, detail=f"Could not read the audio: {type(e).__name__}")
    return {"text": str(text).strip(), "seconds": round(time.time() - started, 2)}
