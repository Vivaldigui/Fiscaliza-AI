# Fiscaliza AI

Aplicação interna, estruturada e auditável para acompanhar requerimentos, indicações, respostas, evidências e prazos de uma Câmara Municipal. Esta entrega implementa a **Fase 1 (fundação)** e documenta as fases seguintes.

## O que já está implementado

- monorepo TypeScript com NestJS, Next.js, Prisma e contratos compartilhados;
- schema completo de domínio, migration inicial e seed seguro;
- login, access JWT curto, refresh rotativo, cookies HttpOnly, RBAC e auditoria;
- usuários, vereadores, identidades WhatsApp administrativas e configurações versionadas;
- health checks para PostgreSQL, Redis e MinIO;
- dashboard responsivo e acessível com navegação do MVP;
- PostgreSQL/pgvector, Redis, MinIO, API e web via Docker Compose;
- abstração `LLMProvider`, implementação inicial Anthropic e prompts versionados (a ativação do pipeline é Fase 4);
- contratos e exemplos inativos de workflows n8n.

Upload, extração/OCR, filas documentais, associação, prazos operacionais, análise, RAG e WhatsApp end-to-end estão deliberadamente nas fases 2–5 de `docs/IMPLEMENTATION_PLAN.md`.

## Pré-requisitos

- Node.js 22+
- pnpm 11+
- Docker com Compose

## Configuração local

1. Copie `.env.example` para `.env`.
2. Substitua todos os valores `CHANGE_ME` por segredos locais fortes.
3. Para criar o primeiro administrador, defina `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (mínimo 12 caracteres, sem `CHANGE_ME`) e `SEED_ADMIN_NAME`.

Nunca envie `.env` ao Git. As variáveis `LLM_API_KEY`, `UAZAPI_TOKEN`, `MINIO_SECRET_KEY`, `DATABASE_URL` e segredos JWT não pertencem ao frontend.

## Execução com Docker

```bash
docker compose up -d postgres redis minio minio-init
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
docker compose up --build api web
```

Ou, depois de existir uma migration e o seed já ter sido executado:

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:3001/api/v1
- Swagger: http://localhost:3001/api/docs
- Health: http://localhost:3001/health
- Console MinIO: http://localhost:9001

O Compose não inicia n8n; integra-se a uma instalação existente conforme `infra/n8n/README.md`.

## Execução sem containers para API/web

Mantenha PostgreSQL, Redis e MinIO disponíveis, ajuste os hosts de `.env` para `localhost` e execute:

```bash
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

## Qualidade

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Testes de integração que dependem de infraestrutura serão adicionados/expandidos junto aos módulos das fases correspondentes. Fixtures devem ser inteiramente fictícias.

## Bootstrap e seed

O seed é idempotente para papéis e configurações. Ele só cria/atualiza o administrador quando e-mail e senha são fornecidos juntos. Um placeholder ou senha curta interrompe a operação; nenhuma credencial padrão é embutida no código.

Configurações seed (todas editáveis e auditáveis): prazo inicial, prorrogação, modo de contagem, timezone, suspensão, antecedência, confiança, associação e limite documental.

## Documentação

- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/AI_PIPELINE.md`
- `docs/WHATSAPP_FLOW.md`
- `docs/SECURITY.md`
- `docs/IMPLEMENTATION_PLAN.md`

Antes de produção, trate como bloqueadores o checklist de segurança, a política LGPD, a regra administrativa exata de contagem, o antivírus/quarentena, o contrato real da UAZAPI e os testes de restauração.
