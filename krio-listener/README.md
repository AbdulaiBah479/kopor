---
title: Kopor Krio listener
emoji: 🎙️
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Krio speech to text for the Kopor shop app
---

# Kopor Krio listener

Speech to text for **Krio** (Sierra Leone), used by the [Kopor](https://abdulaibah479.github.io/kopor/) business app as a
third listener next to Whisper and Gemini. It runs Meta's
[Omnilingual ASR](https://github.com/facebookresearch/omnilingual-asr) (Apache 2.0), which was trained on 67 hours of
Krio and also knows Mende, Temne and 1,600+ other languages.

- `GET /`: health check.
- `POST /transcribe?lang=kri`: body is a WAV recording (up to 40 seconds); header `x-krio-key` is the Space secret
  `KRIO_KEY`. Returns `{"text": "..."}`.

Only Kopor's server holds the key. Recordings are not stored.

© 2026 Abdulai Bah. All rights reserved (see the LICENSE of the Kopor repository). The Omnilingual ASR model it runs is
by Meta, under the Apache 2.0 licence.
