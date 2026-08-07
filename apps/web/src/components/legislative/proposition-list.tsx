'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import {
  deadlineStatusLabel,
  formatDate,
  propositionStatusLabel,
  propositionTypeLabel,
  statusTone,
} from '../../lib/legislative';

interface PropositionItem {
  id: string;
  type: 'REQUEST' | 'INDICATION';
  number: number;
  year: number;
  subject: string;
  status: string;
  protocolDate?: string;
  authors: Array<{ councilor: { id: string; displayName: string } }>;
  deadline?: { status: string; currentDueDate: string };
  _count: { responses: number; documents: number };
}

export function PropositionList({ type }: { type?: 'REQUEST' | 'INDICATION' }) {
  const [items, setItems] = useState<PropositionItem[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ limit: '100', ...(type ? { type } : {}) });
    const externalQuery = new URLSearchParams(window.location.search);
    for (const key of ['status', 'deadlineStatus']) {
      const value = externalQuery.get(key);
      if (value) query.set(key, value);
    }
    if (search.trim()) query.set('search', search.trim());
    const timer = setTimeout(() => {
      apiFetch<{ items: PropositionItem[] }>(`/propositions?${query}`)
        .then(({ items: next }) => setItems(next))
        .catch((caught: Error) => setError(caught.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, type]);

  const title =
    type === 'REQUEST' ? 'Requerimentos' : type === 'INDICATION' ? 'Indicações' : 'Proposições';
  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Acompanhamento</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-black/50">
            Cadastro, autoria, respostas e prazo em uma única visão.
          </p>
        </div>
        <Link className="button-primary" href={`/proposicoes/nova${type ? `?type=${type}` : ''}`}>
          Nova proposição
        </Link>
      </div>
      <div className="card mt-7 p-4">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-black/45"
          htmlFor="search"
        >
          Busca
        </label>
        <input
          id="search"
          className="mt-2 w-full rounded-xl border border-black/10 px-4 py-3 text-sm outline-none focus:border-brand-500"
          placeholder="Assunto, protocolo ou destinatário"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="card mt-5 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[.02] text-xs uppercase tracking-wide text-black/45">
            <tr>
              <th className="px-5 py-4">Proposição</th>
              <th className="px-5 py-4">Assunto</th>
              <th className="px-5 py-4">Autores</th>
              <th className="px-5 py-4">Prazo</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Respostas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-black/[.015]">
                <td className="px-5 py-4">
                  <Link
                    className="font-semibold text-brand-700 hover:underline"
                    href={`/proposicoes/${item.id}`}
                  >
                    {propositionTypeLabel[item.type]} {item.number}/{item.year}
                  </Link>
                  <p className="mt-1 text-xs text-black/40">{formatDate(item.protocolDate)}</p>
                </td>
                <td className="max-w-md px-5 py-4 text-black/70">{item.subject}</td>
                <td className="px-5 py-4 text-black/60">
                  {item.authors.map(({ councilor }) => councilor.displayName).join(', ')}
                </td>
                <td className="px-5 py-4">
                  <p>{formatDate(item.deadline?.currentDueDate)}</p>
                  <p className="mt-1 text-xs text-black/45">
                    {item.deadline ? deadlineStatusLabel[item.deadline.status] : 'Sem prazo'}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}
                  >
                    {propositionStatusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-center font-semibold">{item._count.responses}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && !error ? (
          <div className="p-10 text-center text-sm text-black/45">
            Nenhuma proposição encontrada.
          </div>
        ) : null}
      </div>
    </div>
  );
}
