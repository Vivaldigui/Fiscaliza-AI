import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const [outputPath, fixture = 'three-pages'] = process.argv.slice(2);
if (fixture === 'corrupt') {
  await writeFile(
    outputPath,
    Buffer.from('%PDF-1.7\nfixture sintética intencionalmente corrompida'),
  );
  process.exit(0);
}
if (!outputPath) throw new Error('Informe o caminho de saída.');

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const contents =
  fixture === 'blank'
    ? ['']
    : fixture === 'watcher'
      ? [
          'Documento sintético recebido pela pasta monitorada. Este texto valida estabilidade da cópia, ingestão compartilhada e processamento assíncrono pelo worker.',
        ]
      : [
          'Requerimento fictício 001/2026\nDocumento sintético para validar a primeira página e a preservação da numeração física no pipeline documental.',
          'Solicito informações sobre a frota municipal.\nEste conteúdo sintético possui texto adicional suficiente para validar a extração digital da segunda página.',
          'Fim do documento.\nA terceira página encerra a fixture fictícia e confirma que nenhuma página foi concatenada ou renumerada.',
        ];

for (const content of contents) {
  const page = pdf.addPage([595, 842]);
  const lines = content.split('\n');
  lines.forEach((line, index) =>
    page.drawText(line, { x: 50, y: 780 - index * 22, size: 12, font }),
  );
}

await writeFile(outputPath, await pdf.save());
