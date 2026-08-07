# Relatório da Fase 3 — Proposições, respostas, associação e prazos

**Data da entrega:** 2026-08-07
**Escopo:** camada legislativa administrativa determinística, sem análise semântica por IA, embeddings, RAG, WhatsApp ou notificações externas.

## Resultado

A Fase 3 transforma os documentos seguros da Fase 2 em proposições, respostas, associações explicáveis e prazos auditáveis. A Secretaria consegue executar o fluxo pelo painel: classificar um documento processado, cadastrar requerimento/indicação com coautoria, cadastrar uma ou mais respostas, revisar candidatos e acompanhar vencimentos.

O arquivo continua separado do evento administrativo. Vínculos reutilizam `Document`/objeto MinIO existente e não copiam bytes. Somente documentos `CLEAN` e `COMPLETED` podem integrar o fluxo normal.

## Gate e preservação das fases anteriores

Antes das alterações, a branch base foi sincronizada com `origin/main` contendo o merge do PR #1 (`ccb1993`). O worktree estava limpo e a Fase 2 foi confirmada por documentação, schema, migrations, código da API/web/worker e infraestrutura.

No gate inicial passaram:

- Prisma validate/generate;
- format check, lint e typecheck;
- 36 testes existentes;
- build do monorepo;
- migrations e health reais da stack Docker da Fase 2.

Nenhuma migration entregue foi editada. A implementação foi feita na branch `agent/fase-3-proposicoes-prazos` e adiciona somente a migration incremental `202608072300_phase3_legislative_tracking`.

## Implementado

### Proposições e coautoria

- CRUD/listagem de `REQUEST` e `INDICATION` com filtros por tipo, número, ano, autor, status, assunto e prazo;
- `PropositionAuthor` N:N com papéis `PRIMARY` e `COAUTHOR`;
- exatamente um autor principal e múltiplos coautores sem duplicar a proposição;
- identidade única `(type, number, year)` preservada e decisão sobre origem/unidade explicitamente adiada;
- `PropositionDocument` com `PRIMARY`, `ATTACHMENT` e `SUPPORTING`;
- um único documento principal por constraint parcial;
- vínculo somente de documento seguro/concluído, sem novo upload ou cópia no MinIO;
- timeline derivada de registros de domínio e auditoria, nunca inventada pelo frontend.

### Inbox e respostas

- inbox operacional de documentos ainda sem classificação/vínculo;
- sugestão determinística de tipo/número/ano por regex, sempre sujeita a revisão;
- classificação como proposição, resposta, prorrogação, anexo ou desconhecido;
- `Response` 0..N por proposição e tipos `INITIAL`, `COMPLEMENTARY`, `RECTIFICATION`, `OTHER`;
- resposta inicialmente não associada e com múltiplos `ResponseDocument`;
- um único documento principal e demais anexos/suportes;
- separação explícita entre `DeadlineExtensionRequest` e `DeadlineExtension`;
- estrutura antiga preservada como `LegacyResponseExtension`, sem uso por novos fluxos.

### Associação explicável

- motor semântico zero: referência explícita, tipo, número, ano, protocolo, assunto lexical e proximidade temporal;
- pesos Zod configuráveis que devem somar 1;
- `AssociationEvaluation` com snapshot, top score, segundo score e margem;
- `AssociationCandidate` com rank, sinais e explicações;
- associação automática somente com threshold **e** margem satisfeitos;
- ambiguidade sempre em `NEEDS_REVIEW`;
- confirmação/rejeição manual e correção posterior;
- `ResponseAssociationRevision` append-only;
- versão otimista para impedir duas decisões concorrentes;
- auditoria e outbox na mesma transação.

### Prazos

- política independente por `REQUEST` e `INDICATION`;
- dias corridos/úteis, timezone IANA, regra do dia inicial e ajuste de vencimento não útil;
- `Holiday` manual por escopo nacional, estadual, municipal ou institucional;
- `configurationSnapshot` com versão, política completa e feriados usados;
- alteração global de configuração sem efeito retroativo;
- pedido de prorrogação separado da concessão;
- histórico imutável de data anterior/nova, dias, ator e motivo;
- suspensão/retomada com histórico, recálculo e uma única suspensão aberta;
- concorrência otimista em alterações de prazo;
- `RESPONSE_RECEIVED` separado de `RESPONDED` sem presumir atendimento integral;
- scheduler BullMQ idempotente para `DUE_SOON` e `OVERDUE`;
- eventos outbox `DeadlineCreated`, `DeadlineExtended`, `DeadlineApproaching` e `DeadlineExpired`.

### API e painel

Novos grupos REST documentados no Swagger:

- `/api/v1/propositions`;
- `/api/v1/responses`;
- `/api/v1/associations`;
- `/api/v1/deadlines`;
- `/api/v1/holidays`;
- endpoints de inbox/classificação em `/api/v1/documents`.

Novas telas:

- Proposições, Requerimentos e Indicações;
- cadastro e detalhe com autores, documentos, respostas, prazo e timeline;
- Respostas e cadastro com múltiplos documentos;
- Associações pendentes com score/sinais e confirmação;
- Prazos com prorrogação, suspensão e retomada;
- Feriados;
- dashboard com cards operacionais clicáveis;
- detalhe documental com sugestão/classificação e navegação ao fluxo legislativo.

`ADMIN` e `SECRETARIAT` executam mutações. `AUDITOR` possui consulta. A exposição a `COUNCILOR` ficou deliberadamente bloqueada até a Câmara definir a visibilidade entre gabinetes; o modelo já considera todos os coautores.

## Versionamento documental

A dívida crítica da Fase 2 foi resolvida, não apenas documentada:

- `DocumentPage` e `DocumentChunk` pertencem a `DocumentProcessingAttempt`;
- unicidade de página/chunk passou a ser por tentativa;
- reprocessamento não remove derivados de tentativas anteriores;
- `AnalysisDocument` exige a tentativa usada;
- `Evidence` exige `documentPageId` com deleção restrita;
- migration faz backfill e aborta se algum vínculo histórico ficar incompleto.

A decisão e a estratégia de compatibilidade estão em `adr/ADR-001-DOCUMENT-PROCESSING-VERSIONING.md`.

## Schema e concorrência

A migration incremental adiciona coautoria, avaliações/candidatos versionados, revisões de associação, pedidos de prorrogação, scopes de feriado, versões otimistas e vínculos de tentativa/página. Também cria índices de listagem e constraints parciais para:

- autor principal único;
- documento principal único por proposição/resposta;
- suspensão aberta única;
- concessão única por pedido;
- vínculos e identidade legislativa sem duplicação.

A migration instala configurações determinísticas ausentes com `ON CONFLICT DO NOTHING`, portanto não sobrescreve decisões existentes.

## Validação executada

Resultado final registrado nesta entrega:

| Verificação                               | Resultado                                |
| ----------------------------------------- | ---------------------------------------- |
| Prisma validate                           | passou                                   |
| Prisma generate                           | passou                                   |
| Prisma migrate deploy em PostgreSQL limpo | 4 migrations aplicadas                   |
| Prisma schema diff após migrations        | vazio                                    |
| format check                              | passou                                   |
| lint                                      | passou                                   |
| typecheck                                 | passou                                   |
| testes unitários                          | 52 passaram                              |
| testes de integração PostgreSQL           | 2 passaram                               |
| build monorepo                            | passou                                   |
| imagens Docker API/worker/web/migrate     | reconstruídas                            |
| API `/health`                             | saudável; PostgreSQL, Redis e MinIO `up` |
| worker `/health/ready`                    | saudável; PostgreSQL, Redis e MinIO `up` |
| web protegida                             | respondeu e redirecionou para `/login`   |
| scheduler de prazo no Redis               | registrado e executado                   |
| embeddings não nulos                      | 0                                        |

Os testes incluem os casos críticos:

- Requerimento 10/2026 versus Requerimento 11/2026 e Indicação 10/2026;
- referência explícita seleciona o requerimento correto;
- scores 0,88 e 0,86 nunca autoassociam quando a margem mínima não é atendida;
- 15 dias corridos/úteis, fim de semana, feriado, extensão, suspensão e timezone;
- snapshot A conserva 15 dias após configuração mudar para 20, e B usa 20;
- Requerimento 20/2026 é único com três autores;
- documento processado é vinculado sem mudar `storageKey`;
- documento infectado é bloqueado;
- job de prazo repetido não duplica evento;
- reprocessamento preserva tentativa documental anterior.

A validação Docker usou a infraestrutura local real e não apagou dados existentes. O primeiro start encontrou uma divergência entre a credencial declarada no `.env` local e a credencial já persistida no volume PostgreSQL; o diagnóstico foi explícito e a validação prosseguiu com override de ambiente somente para o comando, sem reset do volume. Com a credencial do volume, migration, API, worker e web ficaram saudáveis.

O host Windows também possuía um PostgreSQL próprio concorrendo na porta 5432. Tentativas de integração via `localhost`/`127.0.0.1` atingiram esse serviço em vez do container. A validação definitiva foi executada dentro da imagem atual da API e da rede Compose, onde os 2 testes passaram. O CLI do Prisma, por usar `prisma.config.ts`, exigiu `DATABASE_URL` explícita no processo; validate/generate finais usaram uma URL apenas sintática, sem ler ou expor o segredo local.

Uma tentativa de rodar build e typecheck em paralelo provocou corrida na pasta gerada `.next/types`. A ordem real do CI é sequencial; a suíte completa foi repetida nessa ordem e passou. A regressão também detectou uma fixture de coautoria sem `originalDueDate` após a inclusão da auditoria `DEADLINE_CREATED`; a fixture foi corrigida para refletir o contrato real do Prisma.

## Auditoria e observabilidade

Foram adicionados logs/auditorias para criação/alteração/vínculo de proposição, resposta, associação automática/manual/corrigida, criação/extensão/suspensão/retomada de prazo e CRUD de feriado. Payloads contêm IDs, versões, scores/datas mínimos e nunca texto integral do PDF.

O worker registra `deadlineId`, job, quantidades e duração da varredura. A execução real registrou a varredura idempotente de prazos concluída.

## Verificação de ausência de IA

Os módulos runtime da Fase 3 não referenciam `AnthropicProvider`, `OpenAIProvider`, `LLMProvider` ou embedding. A consulta no PostgreSQL real encontrou zero `DocumentChunk.embedding` preenchido. Nenhum `Analysis` ou `AIUsage` é criado pelo fluxo desta fase.

## Pendências e decisões institucionais

Não são falhas de implementação, mas precisam de definição antes da operação oficial:

1. validar se `(type, number, year)` é único em todas as unidades/legislaturas ou se a chave precisa de origem;
2. aprovar inclusão/exclusão do dia inicial e ajuste de vencimento não útil;
3. confirmar política formal de prazo para indicações;
4. definir visibilidade entre gabinetes e liberar `COUNCILOR` somente depois;
5. cadastrar o calendário municipal/institucional oficial;
6. definir se/como um prazo histórico pode ser recalculado por ato administrativo excepcional.

## Limites deliberados

- regex e associação são determinísticas; não compreendem significado jurídico;
- “resposta recebida” não significa “respondido integralmente”;
- não há decomposição de perguntas, análise item a item ou resumo por IA;
- nenhum embedding, RAG, chat ou WhatsApp foi implementado;
- não há download automático de feriados;
- OCR e antivírus permanecem com as limitações documentadas na Fase 2 e não foram substituídos.

## Conclusão

A camada administrativa está estruturada, transacional e auditável. A futura Fase 4 poderá consumir proposição, autoria, respostas e a versão exata de cada página sem inferir estrutura administrativa com IA e sem perder evidências após reprocessamento.
