# Integração n8n

O n8n é orquestrador; autorização, idempotência, sessão, associação, prazo, análise e notificação permanecem no backend. Os workflows de exemplo da Fase 5B são importáveis e inativos (`"active": false`).

## Workflows

1. `whatsapp-inbound.workflow.example.json` — webhook UAZAPI → normalização → `POST /api/v1/integrations/whatsapp/inbound` (assinado com `x-fiscaliza-timestamp` + `x-fiscaliza-signature`) → resposta ao webhook.
2. `notification-delivery.workflow.example.json` — webhook assinado do backend em `/notification-delivery` → validação de assinatura → envio UAZAPI com `idempotencyKey` → `POST /api/v1/integrations/whatsapp/delivery-callback` (`SENT` + `externalMessageId`) → `202`. Cobre respostas de conversa, análises de resposta e alertas de prazo.
3. `response-analysis-notification.workflow.example.json` / `deadline-alert.workflow.example.json` — referências de filtro por `notificationType` que delegam ao fluxo consolidado de entrega.

## Variáveis esperadas no n8n

- `FISCALIZA_API_URL` — base da API (ex.: `https://api.exemplo/api/v1`);
- `FISCALIZA_N8N_SECRET` — segredo compartilhado (mesmo valor de `N8N_WEBHOOK_SECRET` no backend);
- `UAZAPI_SEND_URL` — endpoint de envio da UAZAPI;
- `UAZAPI_TOKEN` — credencial da UAZAPI (armazenada no credential store do n8n; **nunca** nos JSONs).

## Observações

- Nenhum JSON contém credenciais.
- Timeouts e política de retry são operacionais; o backend mantém retries próprios com backoff (ver `docs/NOTIFICATION_DELIVERY.md`).
- O contrato real da UAZAPI não foi validado neste ambiente; validar com a instalação real antes de produção (ver `docs/PHASE_5B_REPORT.md`).

Consulte `docs/WHATSAPP_FLOW.md` para contratos e regras de segurança.
