FROM node:22-alpine

RUN apk add --no-cache libc6-compat openssl wget && corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@fiscaliza/api

EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
