FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    openssl \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-por \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@fiscaliza/worker

EXPOSE 3002
CMD ["node", "apps/worker/dist/main.js"]
