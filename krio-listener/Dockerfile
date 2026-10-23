FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# Download the model while building, so a restart does not keep the first recording waiting for it.
ARG OMNI_MODEL=omniASR_CTC_1B_v2
ENV OMNI_MODEL=${OMNI_MODEL}
RUN python -c "import os; from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline; ASRInferencePipeline(model_card=os.environ['OMNI_MODEL'])"

COPY --chown=user app.py .
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
