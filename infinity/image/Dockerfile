# Copyright 2025-2026 Nuvolaris Inc
# SPDX-License-Identifier: AGPL-3.0-or-later
# Dedicated add-on image; never used by the Trustant image build.
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ARG TARGETARCH
LABEL org.opencontainers.image.title="Trustant Infinity CPU add-on" \
      org.opencontainers.image.version="0.0.78" \
      ai.trustant.addon="infinity"
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/cache/huggingface DO_NOT_TRACK=1 HF_HUB_DISABLE_TELEMETRY=1 \
    OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
RUN python -m pip install --no-cache-dir uv==0.13.0
COPY requirements-${TARGETARCH}.txt /tmp/requirements.txt
RUN uv pip install --system --no-cache --require-hashes --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt \
    && python -c 'import torch, infinity_emb; assert torch.version.cuda is None; print(torch.__version__, infinity_emb.__version__)' \
    && infinity_emb v2 --help >/dev/null
RUN useradd --create-home --uid 10001 infinity && mkdir -p /cache && chown infinity:infinity /cache
USER 10001:10001
COPY --chown=10001:10001 start.py /usr/local/bin/infinity-cpu-start.py
EXPOSE 7997
ENTRYPOINT ["python", "/usr/local/bin/infinity-cpu-start.py"]
