FROM node:22-alpine

RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm turbo run build --filter=@fiscaliza/web

EXPOSE 3000
CMD ["pnpm", "--filter", "@fiscaliza/web", "start"]
