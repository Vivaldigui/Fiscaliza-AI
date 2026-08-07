# Fixtures documentais sintéticas

As fixtures da Fase 2 são geradas em tempo de teste por `apps/worker/scripts/generate-synthetic-pdf.mjs` e pelos testes com `pdf-lib`. Nenhum documento real da Câmara é versionado.

- `three-pages`: três páginas com os textos do teste crítico de fidelidade de página e conteúdo adicional fictício.
- `blank`: uma página sem camada textual, usada para acionar a decisão condicional de OCR.

Arquivos corrompidos, conteúdo não PDF renomeado e arquivos acima do limite são construídos em diretório temporário e removidos ao fim da suíte.
