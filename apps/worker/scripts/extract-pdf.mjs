import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [inputPath, outputPath, maximumPagesInput] = process.argv.slice(2);
if (!inputPath || !outputPath)
  throw new Error('Uso: extract-pdf.mjs input.pdf output.json maxPages');
const maximumPages = Number(maximumPagesInput ?? 500);
const data = new Uint8Array(await readFile(inputPath));
const loadingTask = getDocument({
  data,
  isEvalSupported: false,
  useSystemFonts: true,
  disableFontFace: true,
  stopEventLoops: true,
});

try {
  const pdf = await loadingTask.promise;
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('DOCUMENT_CORRUPTED');
  if (pdf.numPages > maximumPages) throw new Error('DOCUMENT_PAGE_LIMIT_EXCEEDED');
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: false });
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const value = item.str.trim();
      if (value) text += `${value}${item.hasEOL ? '\n' : ' '}`;
      else if (item.hasEOL) text += '\n';
    }
    pages.push({ pageNumber, text: text.replace(/[ \t]+\n/g, '\n').trim() });
    page.cleanup();
  }
  await writeFile(outputPath, JSON.stringify({ pageCount: pdf.numPages, pages }), 'utf8');
} finally {
  await loadingTask.destroy();
}
