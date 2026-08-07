'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { formatBytes, processingLabels, statusTone } from '../../../../lib/documents';

interface Attempt {
  id: string;
  attempt: number;
  trigger: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface DocumentDetail {
  id: string;
  originalName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: string;
  pageCount: number | null;
  processingStatus: string;
  textExtractionStatus: string;
  ocrStatus: string;
  securityStatus: string;
  reviewRequired: boolean;
  processingError: string | null;
  lastErrorCode: string | null;
  ingestionSource: string;
  createdAt: string;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingAttempts: Attempt[];
  _count: { pages: number; chunks: number };
  embeddingCreated: boolean;
}

interface DocumentPage {
  id: string;
  pageNumber: number;
  extractedText: string | null;
  ocrText: string | null;
  effectiveText: string;
  effectiveTextSource: string;
  qualityScore: string | number | null;
  characterCount: number;
  requiresOcr: boolean;
  qualityReason: string | null;
  ocrStatus: string;
}

interface UserIdentity {
  roles: string[];
}

const active = new Set([
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCAN',
  'EXTRACTING',
  'OCR',
  'CHUNKING',
]);

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError(null);
      try {
        const detail = await apiFetch<DocumentDetail>(`/documents/${id}`);
        setDocument(detail);
        if (detail._count.pages > 0)
          setPages(await apiFetch<DocumentPage[]>(`/documents/${id}/pages`));
        else setPages([]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Falha ao carregar documento.');
      }
    },
    [id],
  );

  useEffect(() => {
    void Promise.all([
      load(),
      apiFetch<UserIdentity>('/auth/me').then((user) => setRoles(user.roles)),
    ]);
  }, [load]);
  useEffect(() => {
    if (!document || !active.has(document.processingStatus)) return;
    const timer = window.setInterval(() => void load(true), 4_000);
    return () => window.clearInterval(timer);
  }, [document, load]);

  const canManage = roles.includes('ADMIN') || roles.includes('SECRETARIAT');
  const canReprocess =
    canManage && document && ['FAILED', 'NEEDS_REVIEW'].includes(document.processingStatus);

  async function download(pageNumber?: number) {
    setWorking(true);
    setError(null);
    try {
      const result = await apiFetch<{ url: string }>(`/documents/${id}/download`);
      const target = pageNumber ? `${result.url}#page=${pageNumber}` : result.url;
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Original indisponível.');
    } finally {
      setWorking(false);
    }
  }

  async function reprocess() {
    setWorking(true);
    setError(null);
    try {
      await apiFetch(`/documents/${id}/reprocess`, { method: 'POST' });
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível reprocessar.');
    } finally {
      setWorking(false);
    }
  }

  if (!document && !error) return <p className="text-sm text-black/45">Carregando documento…</p>;

  return (
    <div className="mx-auto max-w-[1480px]">
      <Link href="/documentos" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Voltar aos documentos
      </Link>
      {error ? (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {document ? (
        <>
          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-600">
                Documento em{' '}
                {document.ingestionSource === 'INBOX' ? 'pasta de entrada' : 'upload manual'}
              </p>
              <h1 className="mt-1 break-words text-3xl font-semibold tracking-[-.03em]">
                {document.originalName}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(document.processingStatus)}`}
                >
                  {processingLabels[document.processingStatus] ?? document.processingStatus}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(document.securityStatus)}`}
                >
                  Segurança: {document.securityStatus}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(document.ocrStatus)}`}
                >
                  OCR: {document.ocrStatus}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <button
                className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                type="button"
                disabled={working || document.securityStatus !== 'CLEAN'}
                onClick={() => void download()}
              >
                Abrir PDF original
              </button>
              {canReprocess ? (
                <button
                  className="button-primary"
                  type="button"
                  disabled={working}
                  onClick={reprocess}
                >
                  Reprocessar
                </button>
              ) : null}
            </div>
          </div>

          {document.processingError ? (
            <div className="mt-6 rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-amber">
              <strong>{document.lastErrorCode ?? 'Atenção'}:</strong> {document.processingError}
            </div>
          ) : null}

          <section className="mt-7 grid gap-5 lg:grid-cols-[1fr_.65fr]">
            <article className="card p-5 sm:p-6">
              <h2 className="font-semibold">Metadados e integridade</h2>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <Item label="Checksum SHA-256" value={document.sha256} mono />
                <Item label="Tamanho" value={formatBytes(document.sizeBytes)} />
                <Item label="Páginas" value={String(document.pageCount ?? '—')} />
                <Item label="Chunks sem embedding" value={String(document._count.chunks)} />
                <Item label="Extração" value={document.textExtractionStatus} />
                <Item
                  label="Recebido em"
                  value={new Date(document.createdAt).toLocaleString('pt-BR')}
                />
              </dl>
              <p className="mt-5 text-xs text-black/40">Nenhum embedding foi criado nesta fase.</p>
            </article>
            <article className="card p-5 sm:p-6">
              <h2 className="font-semibold">Histórico de processamento</h2>
              <ol className="mt-5 space-y-4">
                {document.processingAttempts.map((attempt) => (
                  <li key={attempt.id} className="border-l-2 border-brand-100 pl-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <strong>Tentativa {attempt.attempt}</strong>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(attempt.status)}`}
                      >
                        {attempt.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-black/45">
                      {attempt.trigger} • {new Date(attempt.createdAt).toLocaleString('pt-BR')}
                    </p>
                    {attempt.errorMessage ? (
                      <p className="mt-2 text-xs text-red-700">
                        {attempt.errorCode}: {attempt.errorMessage}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </article>
          </section>

          <section className="mt-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Texto por página</h2>
                <p className="mt-1 text-sm text-black/45">
                  A numeração segue a ordem física do PDF.
                </p>
              </div>
              <span className="text-sm text-black/45">{pages.length} página(s)</span>
            </div>
            <div className="mt-4 space-y-3">
              {pages.map((page) => (
                <details
                  className="card group overflow-hidden"
                  key={page.id}
                  open={page.pageNumber === 1}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <strong>Página {page.pageNumber}</strong>
                      <p className="mt-1 text-xs text-black/45">
                        Fonte efetiva: {page.effectiveTextSource} • qualidade{' '}
                        {page.qualityScore ?? '—'} • {page.characterCount} caracteres
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(page.ocrStatus)}`}
                      >
                        OCR {page.ocrStatus}
                      </span>
                      <span className="text-black/35 group-open:rotate-180">⌄</span>
                    </div>
                  </summary>
                  <div className="border-t border-black/5 p-5">
                    {document.securityStatus === 'CLEAN' ? (
                      <button
                        className="mb-4 text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50"
                        type="button"
                        disabled={working}
                        onClick={() => void download(page.pageNumber)}
                      >
                        Abrir esta página no PDF
                      </button>
                    ) : null}
                    {page.qualityReason ? (
                      <p className="mb-4 text-xs text-black/45">Avaliação: {page.qualityReason}</p>
                    ) : null}
                    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl bg-black/[.025] p-4 font-sans text-sm leading-6">
                      {page.effectiveText || 'Nenhum texto confiável foi extraído desta página.'}
                    </pre>
                    {page.ocrText && page.extractedText !== page.ocrText ? (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-semibold text-brand-600">
                          Comparar extração digital e OCR
                        </summary>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          <TextBox title="Extração digital" text={page.extractedText ?? ''} />
                          <TextBox title="OCR" text={page.ocrText} />
                        </div>
                      </details>
                    ) : null}
                  </div>
                </details>
              ))}
              {!pages.length ? (
                <div className="card p-10 text-center text-sm text-black/45">
                  As páginas aparecerão após a extração.
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Item({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-black/45">{label}</dt>
      <dd className={`mt-1 break-all font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function TextBox({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-black/45">{title}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/[.025] p-3 font-sans text-xs leading-5">
        {text || 'Vazio'}
      </pre>
    </div>
  );
}
