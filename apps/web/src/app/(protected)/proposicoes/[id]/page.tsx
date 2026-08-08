'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { AnalysisPanel } from '../../../../components/legislative/analysis-panel';
import {
  deadlineStatusLabel,
  formatDate,
  propositionStatusLabel,
  propositionTypeLabel,
  responseTypeLabel,
  statusTone,
} from '../../../../lib/legislative';

interface PropositionDetail {
  id: string;
  type: 'REQUEST' | 'INDICATION';
  number: number;
  year: number;
  subject: string;
  summary?: string;
  recipient?: string;
  protocolNumber?: string;
  protocolDate?: string;
  status: string;
  authors: Array<{ role: string; councilor: { id: string; displayName: string; party?: string } }>;
  documents: Array<{
    role: string;
    document: { id: string; originalName: string; pageCount?: number };
  }>;
  responses: Array<{
    id: string;
    type: string;
    protocolDate?: string;
    protocolNumber?: string;
    sender?: string;
    subject?: string;
    documents: Array<{ document: { id: string; originalName: string } }>;
  }>;
  deadline?: {
    id: string;
    status: string;
    originalDueDate: string;
    currentDueDate: string;
    countingMode: string;
    version: number;
    extensions: unknown[];
    suspensions: unknown[];
  };
  timeline: Array<{
    id: string;
    occurredAt: string;
    type: string;
    title: string;
    metadata?: Record<string, unknown>;
  }>;
}

export default function PropositionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [item, setItem] = useState<PropositionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiFetch<PropositionDetail>(`/propositions/${id}`)
        .then(setItem)
        .catch((caught: Error) => setError(caught.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function openDocument(documentId: string) {
    try {
      const { url } = await apiFetch<{ url: string }>(`/documents/${documentId}/download`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Documento indisponível.');
    }
  }

  if (!item)
    return (
      <div className="mx-auto max-w-6xl">
        <p className="text-sm text-black/45">{error ?? 'Carregando proposição…'}</p>
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">{propositionTypeLabel[item.type]}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {item.number}/{item.year}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-black/55">{item.subject}</p>
        </div>
        <span
          className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone(item.status)}`}
        >
          {propositionStatusLabel[item.status] ?? item.status}
        </span>
      </div>
      {error ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="font-semibold">Dados administrativos</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-black/45">Protocolo</dt>
                <dd className="mt-1 font-medium">
                  {item.protocolNumber ?? '—'} · {formatDate(item.protocolDate)}
                </dd>
              </div>
              <div>
                <dt className="text-black/45">Destinatário</dt>
                <dd className="mt-1 font-medium">{item.recipient ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-black/45">Autores</dt>
                <dd className="mt-1 font-medium">
                  {item.authors
                    .map(
                      ({ role, councilor }) =>
                        `${councilor.displayName}${role === 'PRIMARY' ? ' (principal)' : ''}`,
                    )
                    .join(', ')}
                </dd>
              </div>
              {item.summary ? (
                <div className="sm:col-span-2">
                  <dt className="text-black/45">Resumo</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-black/70">{item.summary}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section className="card p-6">
            <h2 className="font-semibold">Documentos</h2>
            <div className="mt-4 space-y-2">
              {item.documents.map(({ role, document }) => (
                <button
                  key={document.id}
                  onClick={() => openDocument(document.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-black/8 p-3 text-left text-sm hover:border-brand-300"
                >
                  <span className="truncate font-medium">{document.originalName}</span>
                  <span className="ml-4 shrink-0 text-xs text-black/45">
                    {role === 'PRIMARY' ? 'Principal' : 'Anexo'} · abrir
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="card p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Respostas</h2>
              <Link
                href={`/respostas/nova?propositionId=${item.id}`}
                className="text-sm font-semibold text-brand-600 hover:underline"
              >
                Cadastrar resposta
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {item.responses.map((response) => (
                <article key={response.id} className="rounded-xl border border-black/8 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-semibold">
                      {responseTypeLabel[response.type] ?? response.type}
                    </h3>
                    <span className="text-xs text-black/45">
                      {formatDate(response.protocolDate)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-black/60">
                    {response.subject ?? response.sender ?? 'Sem assunto informado'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {response.documents.map(({ document }) => (
                      <button
                        onClick={() => openDocument(document.id)}
                        key={document.id}
                        className="rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium hover:bg-black/10"
                      >
                        {document.originalName}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              {!item.responses.length ? (
                <p className="rounded-xl bg-black/[.025] p-5 text-sm text-black/45">
                  Nenhuma resposta protocolada.
                </p>
              ) : null}
            </div>
          </section>
          <AnalysisPanel propositionId={item.id} propositionType={item.type} />
          <section className="card p-6">
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-5 space-y-5 border-l border-black/10 pl-5">
              {item.timeline.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[25px] top-1 size-2 rounded-full bg-brand-500 ring-4 ring-white" />
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="mt-1 text-xs text-black/45">{formatDate(event.occurredAt)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="card p-6">
            <h2 className="font-semibold">Prazo</h2>
            {item.deadline ? (
              <>
                <p className="mt-5 text-3xl font-semibold">
                  {formatDate(item.deadline.currentDueDate)}
                </p>
                <span
                  className={`mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.deadline.status)}`}
                >
                  {deadlineStatusLabel[item.deadline.status] ?? item.deadline.status}
                </span>
                <dl className="mt-5 space-y-3 text-sm">
                  <div>
                    <dt className="text-black/45">Prazo original</dt>
                    <dd>{formatDate(item.deadline.originalDueDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-black/45">Contagem</dt>
                    <dd>
                      {item.deadline.countingMode === 'BUSINESS_DAYS'
                        ? 'Dias úteis'
                        : 'Dias corridos'}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/prazos?propositionId=${item.id}`}
                  className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline"
                >
                  Gerenciar prazo →
                </Link>
              </>
            ) : (
              <p className="mt-4 text-sm text-black/45">Sem prazo.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
