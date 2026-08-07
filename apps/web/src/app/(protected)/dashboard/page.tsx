'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';

interface Summary {
  requests: number;
  indications: number;
  awaitingResponse: number;
  analyzedResponses: number;
  dueSoon: number;
  overdue: number;
}

const emptySummary: Summary = {
  requests: 0,
  indications: 0,
  awaitingResponse: 0,
  analyzedResponses: 0,
  dueSoon: 0,
  overdue: 0,
};

export default function DashboardPage() {
  const [summary, setSummary] = useState(emptySummary);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Summary>('/dashboard/summary')
      .then(setSummary)
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const metrics = [
    {
      label: 'Aguardando resposta',
      value: summary.awaitingResponse,
      hint: 'Proposições ativas',
      tone: 'text-brand-700 bg-brand-50',
    },
    {
      label: 'Vencem em breve',
      value: summary.dueSoon,
      hint: 'Conforme configuração',
      tone: 'text-amber bg-amber/10',
    },
    {
      label: 'Vencidos',
      value: summary.overdue,
      hint: 'Exigem acompanhamento',
      tone: 'text-danger bg-red-50',
    },
    {
      label: 'Respostas analisadas',
      value: summary.analyzedResponses,
      hint: 'Processamento concluído',
      tone: 'text-blue-700 bg-blue-50',
    },
  ];

  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Visão geral</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em] sm:text-4xl">
            Acompanhamento legislativo
          </h1>
          <p className="mt-2 text-sm text-black/50">
            O que precisa de atenção agora, sem perder o histórico.
          </p>
        </div>
        <Link href="/requerimentos" className="button-primary">
          Novo requerimento
        </Link>
      </div>
      {error ? (
        <div
          className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      <section
        className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Indicadores principais"
      >
        {metrics.map((metric) => (
          <article className="card p-5" key={metric.label}>
            <div className={`mb-6 grid size-10 place-items-center rounded-xl ${metric.tone}`}>
              <span className="size-2.5 rounded-full bg-current" />
            </div>
            <p className="text-3xl font-semibold tracking-tight">{metric.value}</p>
            <p className="mt-1 text-sm font-medium">{metric.label}</p>
            <p className="mt-1 text-xs text-black/40">{metric.hint}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
        <article className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-semibold">Panorama das proposições</h2>
              <p className="mt-1 text-xs text-black/45">Cadastros visíveis no seu perfil</p>
            </div>
          </div>
          <div className="grid gap-px bg-black/5 sm:grid-cols-2">
            <div className="bg-white p-6">
              <p className="text-sm text-black/50">Requerimentos</p>
              <p className="mt-2 text-4xl font-semibold">{summary.requests}</p>
              <Link
                className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline"
                href="/requerimentos"
              >
                Ver requerimentos →
              </Link>
            </div>
            <div className="bg-white p-6">
              <p className="text-sm text-black/50">Indicações</p>
              <p className="mt-2 text-4xl font-semibold">{summary.indications}</p>
              <Link
                className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline"
                href="/indicacoes"
              >
                Ver indicações →
              </Link>
            </div>
          </div>
        </article>
        <article className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
              ✓
            </span>
            <div>
              <h2 className="font-semibold">Fundação operacional</h2>
              <p className="text-xs text-black/45">Fase 1</p>
            </div>
          </div>
          <ul className="mt-6 space-y-3 text-sm text-black/60">
            <li>Autenticação e papéis ativos</li>
            <li>Configurações administrativas versionadas</li>
            <li>PostgreSQL, Redis e MinIO monitorados</li>
            <li>Auditoria das ações críticas</li>
          </ul>
        </article>
      </section>
    </div>
  );
}
