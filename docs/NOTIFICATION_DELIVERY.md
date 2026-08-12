# Fiscaliza AI — Entrega de notificações (Fase 5B)

## 1. Contrato de entrega

Toda mensagem externa (resposta de WhatsApp, aviso de análise de resposta ou
alerta de prazo) é representada por uma `Notification` e entregue pelo mesmo
caminho:

```text
NotificationCreated / NotificationRetryRequested (outbox)
  → fila notification-delivery (BullMQ, jobId determinístico)
  → NotificationDeliveryPipeline
      • claim concorrente (status + attempts)
      • NotificationDeliveryAttempt append-only
      • NotificationDeliveryProvider (n8n, webhook assinado)
  → n8n
      • credencial UAZAPI no credential store
      • envia com idempotencyKey
      • externalMessageId
  → POST /api/v1/integrations/whatsapp/delivery-callback (assinado)
  → SENT / DELIVERED / FAILED com validação de transição
```

O n8n é apenas orquestrador: ele não decide autorização, idempotência, prazo,
conteúdo ou mérito. Tudo isso permanece no backend.

## 2. Modelo

`Notification` ganhou, em relação ao scaffold da Fase 1:

- `type` (`NotificationType`): `WHATSAPP_CONVERSATION_REPLY`,
  `RESPONSE_ANALYSIS_COMPLETED`, `DEADLINE_APPROACHING`, `DEADLINE_EXPIRED`;
- destino de canal sem telefone em payload: `identityId` (FK
  `WhatsappIdentity`), `recipientId` (User, opcional) e `destinationPhone`
  (usado apenas para respostas neutras a números sem identidade);
- `templateVersion` para idempotência e versionamento de mensagem;
- `analysisId`/`deadlineId` opcionais para rastreabilidade;
- `NotificationDeliveryAttempt` (append-only): uma linha por tentativa com
  `status`, `provider`, `externalMessageId` e erro sanitizado — o histórico
  nunca depende apenas do `lastError` sobrescrito.

Status: `PENDING → PROCESSING → SENT → DELIVERED`, com `FAILED`/`CANCELLED`
terminais. Transições são validadas: DELIVERED é terminal e um callback
atrasado nunca a regride para SENT/FAILED.

## 3. Idempotência

- criação: `Notification.idempotencyKey` único;
  - resposta de conversa: `whatsapp-reply:<messageId>`;
  - análise de resposta: `response-analysis:<analysisId>:<templateVersion>:<identityId>`;
  - prazo: `deadline:<deadlineId>:<eventType>:<dueDate>:<identityId>:<templateVersion>`.
- entrega: `jobId` determinístico `notification:<id>` + claim no banco
  (`status in (PENDING, PROCESSING)` + `attempts`), então duas execuções
  concorrentes só deixam uma chamar o provedor;
- callback: `notificationId + idempotencyKey` devem corresponder.

## 4. Retries e reconciliação

- BullMQ: `attempts = NOTIFICATION_QUEUE_ATTEMPTS`, backoff exponencial
  `NOTIFICATION_QUEUE_BACKOFF_MS`;
- falha temporária mantém `PENDING` com `nextAttemptAt` e re-enfileira;
- limite atingido marca `FAILED` definitivo (sem retry infinito); retry manual
  (autorizado, `ADMIN`/`SECRETARIAT`) reabre via outbox `NotificationRetryRequested`;
- fila `notification-reconciliation` (intervalo
  `NOTIFICATION_RECONCILIATION_INTERVAL_MS`):
  - `PENDING` com `nextAttemptAt <= now` e tentativas < máximo → re-enfileira;
  - `PROCESSING` preso além de `NOTIFICATION_PROCESSING_STALE_MS` (worker
    morto) → volta a `PENDING`;
  - `PENDING` com tentativas >= máximo → `FAILED`.

## 5. Segurança do webhook

Direção n8n → backend (inbound e callback) e backend → n8n (entrega) usam o
mesmo esquema: `x-fiscaliza-timestamp` + `x-fiscaliza-signature` =
`sha256=HMAC-SHA256(secret, "<timestamp>.<body>")` com comparação
constant-time e janela de `WHATSAPP_INBOUND_MAX_AGE_SECONDS`. Corpos acima de
`WHATSAPP_INBOUND_MAX_BODY_BYTES` são rejeitados.

Logs, auditoria e API nunca expõem o telefone completo (`maskPhone`) nem
payload integral; erros de provedor são sanitizados antes de persistir.

## 6. Variáveis

`N8N_WEBHOOK_BASE_URL`, `N8N_WEBHOOK_SECRET`, `N8N_REQUEST_TIMEOUT_MS`,
`NOTIFICATION_QUEUE_ATTEMPTS`, `NOTIFICATION_QUEUE_BACKOFF_MS`,
`NOTIFICATION_WORKER_CONCURRENCY`, `NOTIFICATION_RECONCILIATION_INTERVAL_MS`,
`NOTIFICATION_PROCESSING_STALE_MS`, `RESPONSE_NOTIFICATIONS_ENABLED`,
`DEADLINE_NOTIFICATIONS_ENABLED` (ver `.env.example`). Em produção,
`WHATSAPP_ENABLED=true` sem segredo/URL falha no startup.

## 7. Limitação conhecida

O contrato real da UAZAPI e do n8n externo **não foi validado neste ambiente**
(sem credenciais). A integração é implementada contra um contrato sintético
(documentado nos workflows `infra/n8n/workflows/*.example.json`) e precisa ser
validada com a instalação real antes de produção.
