# Fiscaliza AI — Segurança e LGPD

## 1. Modelo de ameaça

Ativos principais: documentos, dados pessoais, análises, credenciais, números WhatsApp, histórico e trilha de auditoria. Ameaças prioritárias: acesso horizontal indevido, elevação de privilégio, PDF malicioso, prompt injection, vazamento por RAG, URL S3 reutilizada, segredo em log/frontend, webhook forjado, replay e alteração/apagamento de auditoria.

## 2. Autenticação

- Senhas com Argon2id e parâmetros revisáveis.
- Access token JWT curto, assinado com segredo/ chave exclusiva e claims mínimos (`sub`, sessão, versão).
- Refresh token opaco, aleatório, armazenado apenas como hash, rotativo e revogável; cookie `HttpOnly`, `Secure` em produção e `SameSite=Lax/Strict` conforme implantação.
- Login com rate limit e auditoria de sucesso/falha sem registrar senha.
- Seed não contém senha real: exige `SEED_ADMIN_PASSWORD` em execução explícita ou cria apenas instrução de bootstrap.
- Preparação para SSO/MFA futuro sem alterar identidades de domínio.

## 3. Autorização

RBAC é combinado com escopo de objeto:

- `COUNCILOR`: proposições de sua autoria e compartilhamentos explícitos;
- `SECRETARIAT`: upload, consulta, download de arquivo aprovado e reprocessamento;
- `AUDITOR`: consulta/download de arquivo aprovado e auditoria, sem upload/reprocessamento;
- `ADMIN`: configuração e gestão, respeitando classificação/restrições futuras.

Guards e services aplicam políticas no backend. IDs recebidos nunca são usados antes de verificar escopo. O frontend apenas oculta ações; não é barreira de segurança. Toda busca vetorial filtra documentos autorizados no SQL.

## 4. Upload e arquivos

- Allowlist inicial: PDF (`application/pdf`) verificado por extensão, MIME declarado, assinatura `%PDF-` e inspeção estrutural posterior pelo parser. Nenhum sinal enviado pelo cliente é confiável isoladamente.
- Limite configurável de bytes, páginas e tempo de processamento.
- Nome do arquivo é sanitizado apenas para exibição; `storageKey` é gerado internamente.
- SHA-256 calculado em streaming antes da persistência final; deduplicação é transacional.
- Arquivo nasce em chave de quarentena no bucket privado. Apenas resultado ClamAV `CLEAN` promove a chave; `INFECTED`, `SKIPPED` e falhas não liberam URL.
- O backend autoriza antes de emitir URL assinada curta. O frontend nunca conhece credenciais nem constrói URL MinIO.
- Parser PDF roda em subprocesso com memória/tempo limitados e `isEvalSupported=false`; PDF.js não executa JavaScript incorporado. O ambiente do subprocesso contém somente variáveis operacionais permitidas, sem segredos da aplicação.
- OCR usa `execFile` com argumentos separados, allowlist de idioma, timeout, concorrência limitada e ambiente redigido; não executa comandos derivados do documento.
- ClamAV usa protocolo `INSTREAM` pela rede privada do Compose. Desabilitar antivírus é explícito, gera `SKIPPED`/revisão e é recusável em produção por `DOCUMENT_ANTIVIRUS_REQUIRED=true`.
- PDF infectado permanece isolado e auditado; não há exclusão automática sem política de retenção. PDF inválido/falha de parse termina em revisão/falha, nunca no pipeline de IA.
- A API recebe em arquivo temporário aleatório, impõe um arquivo/campos/tamanho e sempre remove o temporário após ingestão ou rejeição.

## 5. Prompt injection e IA

- Documento é delimitado e tratado como dado não confiável.
- Prompt de sistema proíbe obedecer instruções do documento.
- Modelo não possui ferramentas administrativas, rede arbitrária, banco ou segredos.
- Saída é JSON estrito validado; IDs/páginas/evidências têm verificação determinística.
- RAG usa allowlist de IDs de documento derivada de autorização.
- Não persistir chain-of-thought; apenas resultado, explicação ao usuário, metadados e uso.
- Conteúdo sensível enviado ao provider deve ser coberto por contrato e política administrativa; opção futura de provider regional/on-premise.

## 6. API e web

- `helmet`, CORS por allowlist, limite de corpo e rate limit por rota.
- Validation pipe com whitelist, transformação controlada e rejeição de campos desconhecidos.
- Queries ordenáveis/filtráveis por allowlist; Prisma parametriza SQL.
- CSRF considerado para endpoints com cookie; mutações usam token/header e `SameSite` adequado.
- CSP e headers do Next.js; nenhum segredo usa prefixo público de ambiente.
- Swagger desabilitável/restrito em produção.
- Erros não expõem stack, SQL, caminhos, prompts ou credenciais.

## 7. Integrações e segredos

Segredos (`LLM_API_KEY`, `UAZAPI_TOKEN`, `MINIO_SECRET_KEY`, `DATABASE_URL`, JWT/refresh) ficam em variáveis injetadas/secret manager, nunca no Git, bundle web, logs ou payload de evento. `.env.example` contém placeholders.

Webhooks usam TLS, segredo/assinatura, comparação constante, janela de timestamp e idempotência. Egress deve ser restrito aos endpoints de provider configurados em produção.

## 8. Auditoria

Eventos auditáveis incluem login, leitura/download sensível, upload, associação, correção, revisão, mudança de prazo/configuração/permissão, emissão de URL e ação de integração. `AuditLog` é append-only para a aplicação. Estado anterior/posterior é redigido e limitado; PDFs completos e tokens não entram.

Produção deve exportar logs de auditoria para armazenamento com retenção/imutabilidade e acesso separado. Relógios dos hosts precisam de sincronização.

## 9. LGPD e ciclo de vida

- Classificação padrão `INTERNAL`; publicação nunca é inferida.
- Minimização no contexto de IA, logs e notificações.
- Inventário de finalidades, base legal e operadores deve ser aprovado pela Câmara.
- Retenção configurável por classe documental e obrigação legal.
- Futuro mascaramento cria derivado redigido sem alterar original oficial.
- Atendimento a titular requer busca, exportação e decisão jurídica sobre retenção/exclusão.
- Backups e ambientes não produtivos recebem o mesmo controle; fixtures são fictícias.

## 10. Infraestrutura

- TLS no proxy e, em produção, entre serviços quando disponível.
- PostgreSQL/Redis/MinIO não publicados na internet; redes privadas e credenciais separadas.
- Usuário de banco com menor privilégio; migration role separável da runtime role.
- Backup criptografado, versionamento de bucket, teste de restauração e rotação de chaves.
- Imagens fixadas por versão, varredura de dependências e SBOM no CI.
- Readiness não divulga credenciais nem detalhes internos a clientes anônimos.

## 11. Checklist antes de produção

- [ ] Definir política LGPD, classificação e retenção.
- [ ] Manter antivírus obrigatório, atualizar assinaturas e validar isolamento/limites de parser e OCR no ambiente produtivo.
- [ ] Configurar TLS, proxy confiável, CORS e CSP para domínios reais.
- [ ] Provisionar secret manager e rotação.
- [ ] Trocar bootstrap admin e habilitar MFA/SSO conforme decisão.
- [ ] Testar IDOR em documentos, chunks, análises e URLs assinadas.
- [ ] Fazer threat modeling da UAZAPI/n8n e validar assinatura real disponível.
- [ ] Testar restauração de PostgreSQL e MinIO.
- [ ] Executar SAST, dependency scan, container scan e teste de penetração.
- [ ] Aprovar contrato e tratamento de dados do provider LLM.
