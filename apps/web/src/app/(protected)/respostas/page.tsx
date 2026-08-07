'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import {
  formatDate,
  propositionTypeLabel,
  responseTypeLabel,
  statusTone,
} from '../../../lib/legislative';

interface ResponseItem {
  id: string;
  type: string;
  status: string;
  protocolDate?: string;
  protocolNumber?: string;
  sender?: string;
  subject?: string;
  proposition?: {
    id: string;
    type: 'REQUEST' | 'INDICATION';
    number: number;
    year: number;
    subject: string;
  };
  documents: Array<{ document: { originalName: string } }>;
}

export default function ResponsesPage() {
  const [items, setItems] = useState<ResponseItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const query = new URLSearchParams({ limit: '100' });
    const status = new URLSearchParams(window.location.search).get('status');
    if (status) query.set('status', status);
    apiFetch<{ items: ResponseItem[] }>(`/responses?${query}`)
      .then(({ items }) => setItems(items))
      .catch((caught: Error) => setError(caught.message));
  }, []);
  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Fluxo administrativo</p>
          <h1 className="mt-1 text-3xl font-semibold">Respostas</h1>
          <p className="mt-2 text-sm text-black/50">
            Uma proposição pode possuir resposta inicial, complementos e retificações.
          </p>
        </div>
        <Link className="button-primary" href="/respostas/nova">
          Nova resposta
        </Link>
      </div>
      {error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="card mt-7 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[.02] text-xs uppercase text-black/45">
            <tr>
              <th className="px-5 py-4">Resposta</th>
              <th className="px-5 py-4">Documento</th>
              <th className="px-5 py-4">Proposição associada</th>
              <th className="px-5 py-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-4">
                  <p className="font-semibold">{responseTypeLabel[item.type] ?? item.type}</p>
                  <p className="mt-1 text-xs text-black/45">
                    {item.protocolNumber ?? 'Sem protocolo'} · {formatDate(item.protocolDate)}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <p>{item.subject ?? item.sender ?? '—'}</p>
                  <p className="mt-1 text-xs text-black/40">
                    {item.documents.map(({ document }) => document.originalName).join(', ')}
                  </p>
                </td>
                <td className="px-5 py-4">
                  {item.proposition ? (
                    <Link
                      className="font-semibold text-brand-700 hover:underline"
                      href={`/proposicoes/${item.proposition.id}`}
                    >
                      {propositionTypeLabel[item.proposition.type]} {item.proposition.number}/
                      {item.proposition.year}
                    </Link>
                  ) : (
                    <Link className="font-semibold text-amber hover:underline" href="/associacoes">
                      Pendente de revisão
                    </Link>
                  )}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}
                  >
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? (
          <p className="p-10 text-center text-sm text-black/45">Nenhuma resposta cadastrada.</p>
        ) : null}
      </div>
    </div>
  );
}
