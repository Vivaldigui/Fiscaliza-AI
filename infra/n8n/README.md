# Integração n8n

O n8n é orquestrador; autorização, idempotência, sessão, associação, prazo e análise permanecem na API. Os workflows completos serão ativados na Fase 5.

## Workflows contratados

1. `whatsapp-inbound.workflow.example.json`: webhook UAZAPI → normalização → `POST /api/v1/integrations/whatsapp/inbound` → envio UAZAPI.
2. `response-analysis-notification.workflow.example.json`: webhook autenticado do backend após `ResponseAnalysisCompleted` → envio UAZAPI → callback de entrega.
3. `deadline-alert.workflow.example.json`: evento calculado pelo backend → envio UAZAPI → callback.

Os exemplos não contêm credenciais. Antes de ativá-los, configure credenciais n8n, assinatura do webhook, URLs reais, timeout e política de retry. Os endpoints de integração serão implementados na Fase 5 e, até lá, os exemplos devem permanecer inativos.

Consulte `docs/WHATSAPP_FLOW.md` para contratos e regras de segurança.
