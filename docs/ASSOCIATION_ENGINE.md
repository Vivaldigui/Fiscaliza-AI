# Motor determinístico de associação

## Escopo

A Fase 3 associa uma `Response` a uma `Proposition` sem LLM, embedding ou busca vetorial. O motor usa somente dados estruturados e texto efetivo das páginas da tentativa documental corrente. Seu resultado é explicável, versionado no banco e sempre revisável por `ADMIN` ou `SECRETARIAT`.

Uma resposta continua sendo entidade distinta de um arquivo. Ela pode existir sem proposição, possuir vários documentos e receber várias avaliações ao longo do tempo.

## Entrada e normalização

O serviço lê:

- texto `effectiveText` das páginas correntes dos documentos da resposta;
- protocolo, data e assunto da resposta;
- tipo, número, ano, protocolo, data e assunto das proposições não arquivadas.

Regex normalizada reconhece referências explícitas como `Requerimento nº 10/2026`, `Requerimento n.º 10, de 2026` e `Indicação 10/2026`. Acentos, caixa e pontuação administrativa são normalizados. A regex nunca cria uma proposição nem interpreta seu mérito.

## Sinais

Cada candidato recebe valores de 0 a 1:

| Sinal               | Regra                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `explicitReference` | tipo + número + ano aparecem juntos e exatamente                                                    |
| `number`            | há referência com o mesmo número                                                                    |
| `year`              | há referência com o mesmo ano                                                                       |
| `type`              | há referência com o mesmo tipo legislativo                                                          |
| `protocol`          | identificadores de protocolo normalizados são iguais                                                |
| `subject`           | similaridade de Jaccard entre tokens relevantes                                                     |
| `temporal`          | 1 até 365 dias; 0,5 sem datas ou até 730 dias; 0,2 após isso; 0 se a resposta antecede a proposição |

O score é a soma ponderada, arredondada a três casas. Os pesos devem somar 1 e são validados por Zod em `association.signalWeights`. Defaults iniciais:

```json
{
  "explicitReference": 0.5,
  "number": 0.15,
  "year": 0.1,
  "type": 0.1,
  "protocol": 0.05,
  "subject": 0.05,
  "temporal": 0.05
}
```

O resultado persiste `signalScores` e explicações como “Referência explícita exata encontrada”, sem guardar o documento integral no log.

## Decisão automática

Os candidatos são ordenados por score. Autoassociação ocorre apenas quando as duas condições são verdadeiras:

```text
topScore >= association.autoThreshold
topScore - secondScore >= association.minimumMargin
```

Defaults iniciais: threshold `0.90` e margem `0.15`. Eles são configurações administrativas, não constantes de negócio. Cada `AssociationEvaluation.configurationSnapshot` preserva os valores e pesos usados naquela execução.

Exemplo: `0,91` versus `0,35` pode ser automático; `0,91` versus `0,89` sempre vai para `NEEDS_REVIEW`, apesar de o primeiro ultrapassar o threshold. Sem candidato suficiente, a resposta também fica em revisão.

O tipo faz parte da referência explícita. Assim, `Requerimento 10/2026` não é confundido com `Indicação 10/2026` apenas porque número e ano coincidem.

## Persistência e revisão

- `AssociationEvaluation`: execução, scores principais, margem, estado e snapshot;
- `AssociationCandidate`: até dez opções ranqueadas, sinais, explicações e estado;
- `Response`: proposição atual, método, confiança, ator/data e versão;
- `ResponseAssociationRevision`: estado anterior/novo, método, ator, motivo e data.

Ao reavaliar, candidatos pendentes anteriores viram `SUPERSEDED`; não são apagados. A confirmação manual aceita qualquer proposição válida e registra `MANUAL`. Rejeitar um candidato preserva a resposta em revisão.

`expectedVersion` implementa concorrência otimista. Se outra pessoa associar ou revisar antes, a segunda operação retorna conflito e exige recarga; nunca há sobrescrita silenciosa.

Quando a associação muda, a proposição anterior fica `NEEDS_REVIEW`, a nova fica `RESPONSE_RECEIVED`, e o histórico registra ambos os IDs. `RESPONSE_RECEIVED` só significa que uma resposta foi protocolada/associada; não afirma atendimento total ou parcial.

## Auditoria e eventos

São auditados `RESPONSE_ASSOCIATED_AUTO`, `RESPONSE_ASSOCIATED_MANUAL`, `RESPONSE_ASSOCIATION_CHANGED` e rejeição de candidato. A transação também grava o evento outbox `ResponseAssociated`. Não há notificação externa nesta fase.

## Limitações deliberadas

- assunto usa similaridade lexical simples, não semântica;
- autor/destinatário não são inferidos de linguagem natural;
- regex pode falhar em formatos institucionais ainda desconhecidos;
- avaliação não examina se a resposta atende o conteúdo solicitado;
- nenhuma acusação, conclusão jurídica ou análise de mérito é produzida.

Casos ambíguos são encaminhados a pessoas, não “resolvidos” por heurística oculta.
