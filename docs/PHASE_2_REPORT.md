# Relatório da Fase 2 — Ingestão documental

**Data da entrega:** 2026-08-07
**Escopo:** camada documental até `Document`, `DocumentPage` e `DocumentChunk`, sem classificação, associação, LLM, embeddings, RAG ou WhatsApp.

## Resultado

A Fase 2 adiciona um pipeline documental assíncrono, privado, auditável e reprocessável. Upload HTTP e pasta monitorada convergem para o mesmo `DocumentIngestionService`; a API termina depois da quarentena e da transação de outbox. ClamAV, parsing, OCR e chunking executam exclusivamente em `apps/worker`.

Foram implementados:

- `POST /api/v1/documents` multipart, restrito a `ADMIN`/`SECRETARIAT`, com limite configurável, arquivo temporário aleatório e limpeza garantida;
- validação combinada de extensão, MIME declarado, magic bytes `%PDF-`, tamanho e estrutura pelo parser;
- SHA-256 por stream, constraint única e resposta idempotente sem segundo objeto para duplicatas;
- MinIO privado com chaves `quarantine/{documentId}/original.pdf` e promoção de arquivos limpos para `documents/{anoUTC}/{documentId}/original.pdf`;
- URLs assinadas de curta duração emitidas somente pelo backend, após RBAC e `securityStatus = CLEAN`;
- `DocumentSecurityScanner`, implementação ClamAV `INSTREAM` e modo desabilitado explicitamente marcado `SKIPPED`;
- outbox transacional, dispatcher com `FOR UPDATE SKIP LOCKED`, BullMQ, job ID por documento/tentativa, retries finitos e backoff;
- máquina de estados central e `DocumentProcessingAttempt` para preservar cada tentativa;
- PDF.js atual em subprocesso com memória, timeout, ambiente redigido e `isEvalSupported=false`;
- extração na ordem física, uma `DocumentPage` por página, começando em 1;
- `TextQualityAnalyzer` e decisão de OCR por página, não pela mera existência de texto;
- `OcrProvider` e implementação Tesseract/Poppler seletiva, com idioma, timeout e concorrência configuráveis;
- regra determinística de `effectiveText` e revisão quando nenhuma leitura é confiável;
- chunks confinados à página com sequência e hash; nenhum embedding é produzido;
- watcher com polling compatível com volume Docker/Windows e verificação própria de estabilidade por tamanho/`mtime`;
- listagem, detalhe, páginas, download e reprocessamento, com erros Problem Details e sem stack trace;
- painel web operacional de documentos, filtros, upload, polling de estado, histórico, texto/OCR por página, abertura do PDF na página e reprocessamento;
- health/readiness do worker, ClamAV e worker no Compose, além de CI sem deploy.

## Mudanças de banco

A migration inicial da Fase 1 não foi alterada. Foram adicionadas duas migrations incrementais:

1. `202608071700_phase2_document_ingestion`: novos valores/enums documentais;
2. `202608071710_phase2_document_columns`: colunas, índices, constraints, relações e `document_processing_attempts`.

O desdobramento em duas migrations é intencional. PostgreSQL não permite usar um valor recém-adicionado a enum antes do commit da transação que o criou; a primeira versão combinada falhou com `55P04` durante o teste real e foi corrigida antes da entrega.

Principais adições:

- estados `RECEIVED`, `QUARANTINED`, `SECURITY_SCAN` e `CHUNKING`;
- `DocumentSecurityStatus`, origem, tentativa corrente, erro/timestamps e flag de revisão;
- qualidade, OCR e fonte efetiva em `DocumentPage`;
- histórico `DocumentProcessingAttempt` por `(documentId, attempt)`.

`DocumentChunk.embedding` continua nullable e nenhum fluxo escreve nesse campo. A dimensão física existente `vector(1536)` exige ADR antes da Fase 5.

## Validação da Fase 1 antes das alterações

- worktree inicial limpo e sincronizado com `main`;
- migration inicial preservada;
- Prisma validate/generate, typecheck, testes e build passaram;
- o lint revelou que o arquivo gerado `apps/web/next-env.d.ts` não estava ignorado; a configuração foi corrigida sem alterar código funcional;
- os scripts de teste de `packages/ai` e `packages/document-processing` apontavam para o diretório compilado e podiam terminar sem executar os arquivos esperados; os globs foram corrigidos e os testes reais passaram;
- Docker estava disponível: PostgreSQL, Redis, MinIO, API e web foram verificados antes da evolução.

Nenhuma falha da fundação foi ignorada.

## Testes automatizados

As fixtures são inteiramente sintéticas. A cobertura documental inclui:

- PDF textual de uma página;
- PDF textual crítico de três páginas e preservação exata de `pageNumber`;
- página sem texto e disparo de OCR;
- TXT renomeado para PDF;
- PDF corrompido;
- limite de bytes e limite de páginas;
- SHA-256 por stream e duplicata sem segundo `put` no storage;
- qualidade textual, chunking por página e parser de respostas ClamAV;
- job concluído repetido como no-op;
- transição absurda bloqueada;
- falha já finalizada sem auditoria duplicada;
- watcher detectando PDF estável, aguardando cópia incompleta e ignorando não-PDF;
- RBAC negando operação documental ao vereador e permitindo administração/Secretaria.

Na execução final, `pnpm test` executou 36 testes com sucesso: 3 no pacote de IA já existente, 8 no processamento documental, 15 na API e 10 no worker.

O teste essencial gera três páginas com:

1. `Requerimento fictício 001/2026`;
2. `Solicito informações sobre a frota municipal.`;
3. `Fim do documento.`

O parser retornou `pageCount = 3`, páginas `[1, 2, 3]` e cada texto somente na página física correspondente.

## Testes reais com Docker

A stack foi criada com PostgreSQL/pgvector, Redis, MinIO, `minio-init`, ClamAV, migration, API, worker e web. Foram observados:

- migrations aplicadas em PostgreSQL limpo;
- API e worker com liveness/readiness saudáveis;
- bucket recusando acesso anônimo com HTTP 403;
- upload administrativo retornando `202` e processamento assíncrono pelo worker;
- vereador retornando 403 em upload e download;
- PDF de três páginas concluído com ClamAV `CLEAN`, extração `COMPLETED`, OCR `NOT_REQUIRED`, três páginas e três chunks;
- duplicata retornando o mesmo `documentId`, sem novo registro nem objeto físico;
- URL assinada contendo o endpoint público configurado, download HTTP 200 e expiração curta;
- watcher deixando uma cópia em andamento fora da ingestão, aceitando após estabilidade e movendo para `processed/`;
- PDF válido em branco acionando Poppler/Tesseract somente para sua página e terminando `NEEDS_REVIEW`/OCR `PARTIAL`, sem texto inventado;
- PDF estruturalmente corrompido terminando `FAILED`, nova tentativa por endpoint e bloqueio 409 para pedido concorrente;
- mensagens de falha sanitizadas e tentativa anterior preservada;
- nenhum `DocumentChunk.embedding` não nulo.

O teste de migration criou um banco descartável nomeado, aplicou as três migrations do zero, conferiu `finished_at` e removeu somente esse banco de aceite ao final.

Os valores usados eram locais e descartáveis; nenhuma credencial real ou documento da Câmara foi utilizado.

## Problemas encontrados e corrigidos

- enum PostgreSQL novo usado na mesma migration: migrations separadas por commit;
- dependência transitiva de `multer` ausente na imagem da API: dependência runtime declarada explicitamente;
- hostname interno do MinIO em URL para navegador: cliente de assinatura separado por `MINIO_PUBLIC_ENDPOINT`;
- PDF.js recebendo `Buffer`: conversão explícita para `Uint8Array`;
- chamada inválida a `pdf.destroy()`: ciclo de vida corrigido para `loadingTask.destroy()`;
- glob do watcher incompatível com polling em volume Windows e filtro que ignorava a raiz: observação direta da raiz;
- confiança indevida apenas no `awaitWriteFinish`: estabilidade explícita e testada no código;
- `.gitkeep` tratado como rejeição: arquivos não-PDF são ignorados;
- stderr/stack do PDF.js persistido e falha finalizada duas vezes pelo evento BullMQ: mensagem segura, classificação específica e finalização idempotente;
- detalhe da API retornava campos internos desnecessários: resposta passou a usar allowlist e não expõe `storageKey`.

## Limitações e operação

- Tesseract é uma implementação local inicial. Qualidade varia com resolução, rotação, manuscrito e ruído; resultado insuficiente sempre exige revisão humana.
- O worker renderiza seletivamente as páginas marcadas para OCR. Execução local fora do container requer Poppler e Tesseract instalados.
- ClamAV depende de atualização e monitoramento das assinaturas. O Compose demonstra a integração, mas a política operacional de atualização/alerta precisa ser definida para produção.
- `DOCUMENT_ANTIVIRUS_ENABLED=false` existe apenas para desenvolvimento explícito. Com scanner pulado, o original permanece em quarentena, o documento requer revisão e não recebe URL assinada.
- Não há editor manual avançado de texto nesta fase; revisão permite reprocessar e inspecionar original/textos.
- Não foram implementados classificação, associação, análise jurídica/LLM, embeddings, RAG, WhatsApp ou notificações.

## Decisões para as próximas fases

- revisar na Fase 3 se a identidade de proposição precisa incluir unidade/origem além de tipo+número+ano;
- manter distintos `ResponseExtension` (resposta/documento complementar) e `DeadlineExtension` (evento de prazo), revisando nomenclatura e UX na Fase 3;
- escolher provider, dimensão, versionamento e reindexação de embeddings por ADR antes da Fase 5;
- medir OCR com corpus fictício representativo antes de definir capacidade e concorrência de produção.

## Conclusão

A camada documental está pronta para a Fase 3 consumir `Document` e `DocumentPage` sem refazer ingestão, segurança, numeração física, OCR ou chunks. O pipeline mantém PDF como entrada não confiável, preserva o original e o histórico e não antecipa nenhuma decisão semântica.
