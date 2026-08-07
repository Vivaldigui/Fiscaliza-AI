# Fiscaliza AI — Plano de Implementação

## Estratégia

Entregas pequenas, migráveis e testáveis. Nenhuma fase depende de mocks silenciosos em produção. Integrações ausentes falham de forma explícita e recuperável. Ao fim de cada fase: lint, typecheck, testes, migration em banco limpo, revisão de segurança e atualização dos documentos.

## Fase 0 — Arquitetura e contratos (esta entrega)

**Status:** concluída em 2026-08-07.

- inventário do repositório;
- arquitetura, modelo de dados, pipeline de IA, WhatsApp e segurança;
- schema Prisma completo o suficiente para evitar remodelagem destrutiva;
- plano, riscos e decisões pendentes.

**Saída:** documentação aprovada e migration inicial revisável.

## Fase 1 — Fundação segura e executável (esta entrega)

**Status:** implementada em 2026-08-07. Typecheck, lint, testes, build, validação Prisma/Compose e inspeção visual passaram. A aplicação da migration e os health checks contra serviços reais aguardam o Docker Desktop/daemon disponível no ambiente de validação.

- pnpm/Turborepo TypeScript;
- Docker Compose com PostgreSQL/pgvector, Redis, MinIO, API e web;
- Prisma package, migration inicial e seed de papéis/configurações/admin condicionado a variável;
- NestJS com configuração validada, logs, Helmet, CORS, rate limit e Swagger;
- autenticação JWT + refresh rotativo, RBAC e escopo base;
- CRUD inicial de vereadores e leitura/alteração tipada de configurações;
- health de PostgreSQL, Redis e MinIO;
- Next.js com login, shell responsivo, dashboard operacional inicial e navegação das áreas planejadas;
- testes unitários de autorização/config e integração básica de health/auth quando infraestrutura estiver disponível.

**Critério de aceite:** stack sobe por Compose, migration/seed funcionam, admin faz login, rota protegida respeita papel, health reporta dependências e web não recebe segredos.

## Fase 2 — Ingestão documental

- upload multipart e watcher de `/data/inbox`;
- validação MIME/magic bytes, tamanho, SHA-256 e deduplicação;
- MinIO privado e URLs assinadas;
- BullMQ/outbox e estados de processamento;
- extração de PDF por página, densidade textual e OCR condicional;
- páginas, chunks sem embedding e painel de jobs/revisão;
- antivírus/quarentena configurável.

**Critério:** PDF fictício aparece com páginas corretas; duplicata não duplica bytes; falha é reprocessável.

## Fase 3 — Proposições, associação e prazos

- CRUD completo de requerimentos/indicações e documentos;
- classificação/metadados estruturados;
- `DocumentAssociationService` com candidatos, threshold e margem;
- resposta 1:N, associação manual e auditoria;
- `DeadlineService` com dias corridos/úteis, feriados, suspensão e prorrogações imutáveis;
- filtros/timeline e telas de proposições, respostas, pendências e prazos.

**Critério:** associação ambígua nunca vincula; casos de calendário e extensão passam nos testes.

## Fase 4 — IA estruturada e revisão

- `LLMProvider` e `AnthropicProvider` sem acoplamento de domínio;
- prompts e schemas Zod versionados;
- decomposição distinta de requerimento/indicação;
- análise cumulativa item a item, evidência por página e resumo executivo;
- repair/retry controlado, cache por hash e `AIUsage`;
- revisão humana append-only e telas detalhadas;
- fixture crítica completo/parcial/não respondido.

**Critério:** nenhum JSON/evidência inválido persiste; fixture crítica mantém três estados; alteração humana preserva original.

## Fase 5 — RAG, WhatsApp e notificações

- embeddings configuráveis e índice pgvector;
- consultas estruturadas antes do RAG, com filtros de autorização;
- conversa web e sessão Redis;
- inbound UAZAPI via n8n com idempotência e identidade E.164;
- `ResponseAnalysisCompleted` → `Notification` → workflow n8n;
- retries/status de entrega e alertas de prazo;
- workflows e payloads de exemplo importáveis.

**Critério:** vereador consulta apenas seus documentos; mensagem duplicada não duplica resposta; notificação só sai após análise.

## Fase 6 — Endurecimento e operação piloto

- observabilidade, OpenTelemetry/error tracking, métricas de filas/IA;
- retenção, classificação e mascaramento inicial;
- backups/restauração, antivírus, scans e testes de carga/segurança;
- acessibilidade, treinamento, runbooks e piloto com dados controlados;
- políticas de custo, reprocessamento e revisão de falsos positivos.

**Critério:** checklist de produção aprovado por TI, jurídico/LGPD e usuários da Secretaria.

## Backlog pós-MVP

- minuta de complementação com revisão humana obrigatória;
- consultas multi-documento avançadas;
- comparação histórica neutra com fontes;
- SSO/MFA, classificação automatizada assistida e políticas de retenção completas;
- alta disponibilidade e storage/LLM alternativos.

## Riscos técnicos

| Risco                               | Impacto                             | Mitigação                                                                     |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| PDFs digitalizados/ruins            | itens e evidências incorretos       | OCR por página, confiança, revisão e original visível                         |
| Numeração ambígua                   | resposta ligada à proposição errada | chave composta, múltiplos sinais, threshold+margem, revisão                   |
| Alucinação de página/valor          | perda de confiança institucional    | validação contra `DocumentPage`, evidência obrigatória                        |
| Vazamento por RAG/URL               | incidente LGPD                      | escopo SQL, deny-by-default, URL curta e testes IDOR                          |
| Mudança de modelo/provider          | regressão/custo                     | provider abstrato, prompt/schema versionados, golden tests e cache versionado |
| Regra de prazo municipal específica | prazo incorreto                     | configuração/snapshot, suíte de calendário e aprovação jurídica               |
| UAZAPI/n8n indisponível             | mensagens perdidas/duplicadas       | fila, outbox, idempotência, callbacks e reconciliação                         |
| pgvector com dimensão variável      | reindexação complexa                | provider de embedding separado e versão do índice                             |
| Dados sensíveis em SaaS LLM         | risco contratual/LGPD               | minimização, aprovação do operador e opção futura on-premise                  |
| Seed/bootstrap inseguro             | tomada de conta                     | senha obrigatória via segredo, troca e auditoria                              |

## Decisões que precisam de validação da Câmara

As decisões abaixo não bloqueiam a fundação; defaults conservadores serão usados até aprovação:

1. Regra exata de contagem: inclui/exclui dia do protocolo, vencimento em dia não útil e efeito de suspensão.
2. Calendário de feriados: municipal/estadual/nacional e expediente excepcional.
3. Se `INDICATION` também possui prazo formal e quais eventos o encerram.
4. Origem/unidade na chave quando houver numeração duplicada entre legislaturas/setores.
5. Política de visibilidade entre vereadores, assessores, Secretaria e Auditoria.
6. Classificação, retenção, base legal e possibilidade de enviar conteúdo ao provider LLM escolhido.
7. UAZAPI: formato/assinatura real do webhook, limites, instâncias e garantia de idempotência no envio.
8. Serviço OCR e embedding para produção, idiomas e requisitos de instalação.
9. Canal de alerta, antecedência e destinatários de cada tipo de prazo.
10. Infraestrutura alvo, domínio, TLS, backup, RPO/RTO e secret manager.

## Decisões técnicas de baixo risco adotadas

- pnpm workspaces/Turborepo;
- UTC no banco e timezone IANA no cálculo;
- access JWT curto + refresh opaco rotativo;
- Argon2id;
- outbox transacional;
- bucket privado e URLs assinadas;
- Problem Details e IDs de correlação;
- configuração tipada persistida em JSON com versão/auditoria;
- testes fictícios sem dados pessoais reais.
