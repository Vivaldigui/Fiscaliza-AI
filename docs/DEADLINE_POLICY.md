# Política determinística de prazos

## Princípio

O `DeadlineService` não contém a regra “15 + 15” como decisão fixa. Cada tipo de proposição consulta uma configuração independente:

- `deadlines.policy.REQUEST`;
- `deadlines.policy.INDICATION`.

O valor inicial é 15 dias e prorrogação de 15 dias para ambos, mas a Câmara pode alterá-los separadamente. O backend valida a política completa e copia configuração e feriados aplicáveis para `Deadline.configurationSnapshot` no momento da criação.

Uma mudança administrativa vale somente para novos prazos. Registros existentes continuam calculáveis e auditáveis com a regra que estava vigente.

## Estrutura da política

```json
{
  "policyVersion": 1,
  "initialResponseDays": 15,
  "extensionDays": 15,
  "countingMode": "CALENDAR_DAYS",
  "timezone": "America/Sao_Paulo",
  "dueSoonDays": 3,
  "suspensionEnabled": true,
  "startDayRule": "EXCLUDE_START_DATE",
  "nonBusinessDueDateRule": "NEXT_BUSINESS_DAY",
  "holidayScopes": ["NATIONAL", "STATE", "MUNICIPAL", "INSTITUTIONAL"]
}
```

`policyVersion` deve ser incrementada quando o significado administrativo mudar. `settingVersion`, data de captura, política completa e lista de feriados entram no snapshot.

## Contagem

Modos suportados:

- `CALENDAR_DAYS`: todos os dias consomem prazo;
- `BUSINESS_DAYS`: somente segunda a sexta que não conste como feriado aplicável.

Política do dia inicial:

- `EXCLUDE_START_DATE`: começa a contar no dia seguinte, default inicial;
- `INCLUDE_START_DATE`: o dia base pode consumir o primeiro dia; em modo útil, apenas se for dia útil.

Se a data calculada não for útil:

- `NEXT_BUSINESS_DAY`: avança até o próximo útil, default inicial;
- `PREVIOUS_BUSINESS_DAY`: recua até o útil anterior;
- `KEEP_DATE`: conserva a data civil.

Datas administrativas são calculadas como `YYYY-MM-DD`; instantes de suspensão usam o timezone IANA do snapshot. O default é `America/Sao_Paulo`.

Esses defaults são decisão técnica conservadora, não interpretação jurídica. Devem ser aprovados pela Câmara antes do uso oficial.

## Feriados

Feriados são cadastrados manualmente, sem download externo, com escopos `NATIONAL`, `STATE`, `MUNICIPAL` ou `INSTITUTIONAL`. `(date, scope)` é único. Apenas escopos presentes na política entram no cálculo e a lista usada é congelada no snapshot.

Alterar ou desativar um feriado não muda retroativamente um prazo já criado. Recalcular um prazo histórico exigiria um fluxo administrativo explícito, não existe como efeito colateral do CRUD de feriado.

## Prorrogação

`DeadlineExtensionRequest` representa o pedido/comunicação e não altera a data. `DeadlineExtension` representa a concessão efetiva e preserva:

- `previousDueDate`;
- `newDueDate`;
- `extensionDays`;
- `grantedAt`;
- responsável e motivo;
- pedido de origem, quando existente.

A data original do `Deadline` nunca é sobrescrita. Uma extensão calcula a partir do vencimento corrente usando a política e os feriados congelados. Cada pedido só pode originar uma concessão.

## Suspensão e retomada

Suspensão só é aceita se `suspensionEnabled` estiver habilitado no snapshot. Um índice parcial permite apenas uma suspensão aberta por prazo. A retomada:

1. converte início e fim para o timezone congelado;
2. conta os dias suspensos de acordo com o modo útil/corrido;
3. calcula o novo vencimento com a mesma política;
4. persiste vencimento anterior/novo, atores e timestamps.

Nenhum evento anterior é removido. `version` no prazo evita duas suspensões, retomadas ou prorrogações concorrentes.

## Estados e resposta recebida

- `OPEN`: aberto fora da janela de proximidade;
- `DUE_SOON`: dentro de `dueSoonDays`;
- `OVERDUE`: data atual posterior ao vencimento;
- `EXTENDED`: houve prorrogação efetiva e ainda não venceu;
- `SUSPENDED`: contagem formalmente suspensa;
- `RESPONSE_RECEIVED`: houve resposta protocolada/associada;
- `RESPONDED`: reservado para conclusão semântica futura.

A chegada da primeira resposta não comprova atendimento integral. Na Fase 3, ela somente preenche `responseReceivedAt` e usa `RESPONSE_RECEIVED`.

## Manutenção server-side

O worker mantém a fila BullMQ `deadline-maintenance` com job scheduler determinístico `deadline-status-sweep`. A cada intervalo configurado em `DEADLINE_SWEEP_INTERVAL_MS`, consulta prazos abertos e atualiza `DUE_SOON`/`OVERDUE` sem depender de abertura de tela.

Transições geram no máximo um evento outbox por mudança: `DeadlineApproaching` ou `DeadlineExpired`. Reexecutar o mesmo job com estado já atualizado não duplica o evento.

## Testes obrigatórios cobertos

- 15 dias corridos e úteis;
- fim de semana e feriado municipal;
- prorrogação;
- suspensão/retomada;
- timezone `America/Sao_Paulo`;
- snapshot de 15 dias preservado após configuração global mudar para 20;
- novo prazo criado com 20;
- varredura idempotente de vencimento.
