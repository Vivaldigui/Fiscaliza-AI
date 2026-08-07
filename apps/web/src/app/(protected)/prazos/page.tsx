'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import {
  deadlineStatusLabel,
  formatDate,
  propositionTypeLabel,
  statusTone,
} from '../../../lib/legislative';

interface DeadlineItem {
  id: string;
  currentDueDate: string;
  originalDueDate: string;
  status: string;
  version: number;
  countingMode: string;
  proposition: {
    id: string;
    type: 'REQUEST' | 'INDICATION';
    number: number;
    year: number;
    subject: string;
  };
  extensions: unknown[];
  suspensions: Array<{ endedAt?: string }>;
}

export default function DeadlinesPage() {
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const query = new URLSearchParams({ limit: '100' });
    const externalQuery = new URLSearchParams(window.location.search);
    for (const key of ['status', 'propositionId']) {
      const value = externalQuery.get(key);
      if (value) query.set(key, value);
    }
    return apiFetch<DeadlineItem[]>(`/deadlines?${query}`)
      .then(setItems)
      .catch((caught: Error) => setError(caught.message));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function extend(item: DeadlineItem) {
    const input = window.prompt('Quantidade de dias da prorrogação (vazio usa a política):', '');
    if (input === null) return;
    const reason = window.prompt('Motivo (opcional):') ?? undefined;
    try {
      await apiFetch(`/deadlines/${item.id}/extensions`, {
        method: 'POST',
        body: JSON.stringify({
          version: item.version,
          ...(input ? { extensionDays: Number(input) } : {}),
          reason,
        }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao prorrogar.');
    }
  }
  async function suspend(item: DeadlineItem) {
    const reason = window.prompt('Motivo formal da suspensão:');
    if (!reason) return;
    try {
      await apiFetch(`/deadlines/${item.id}/suspensions`, {
        method: 'POST',
        body: JSON.stringify({ version: item.version, reason }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao suspender.');
    }
  }
  async function resume(item: DeadlineItem) {
    if (!window.confirm('Retomar este prazo e recalcular o vencimento?')) return;
    try {
      await apiFetch(`/deadlines/${item.id}/resume`, {
        method: 'POST',
        body: JSON.stringify({ version: item.version }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao retomar.');
    }
  }
  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Controle administrativo</p>
          <h1 className="mt-1 text-3xl font-semibold">Prazos</h1>
          <p className="mt-2 text-sm text-black/50">
            Cálculo por snapshot, com histórico de prorrogações e suspensões.
          </p>
        </div>
        <Link
          className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold"
          href="/feriados"
        >
          Gerenciar feriados
        </Link>
      </div>
      {error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="card mt-7 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[.02] text-xs uppercase text-black/45">
            <tr>
              <th className="px-5 py-4">Proposição</th>
              <th className="px-5 py-4">Vencimento</th>
              <th className="px-5 py-4">Regra</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-4">
                  <Link
                    href={`/proposicoes/${item.proposition.id}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    {propositionTypeLabel[item.proposition.type]} {item.proposition.number}/
                    {item.proposition.year}
                  </Link>
                  <p className="mt-1 max-w-sm truncate text-xs text-black/45">
                    {item.proposition.subject}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <p className="font-semibold">{formatDate(item.currentDueDate)}</p>
                  <p className="mt-1 text-xs text-black/40">
                    Original: {formatDate(item.originalDueDate)}
                  </p>
                </td>
                <td className="px-5 py-4 text-black/60">
                  {item.countingMode === 'BUSINESS_DAYS' ? 'Dias úteis' : 'Dias corridos'}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}
                  >
                    {deadlineStatusLabel[item.status] ?? item.status}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    {item.status === 'SUSPENDED' ? (
                      <button
                        onClick={() => resume(item)}
                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Retomar
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => extend(item)}
                          className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
                        >
                          Prorrogar
                        </button>
                        <button
                          onClick={() => suspend(item)}
                          className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
                        >
                          Suspender
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? (
          <p className="p-10 text-center text-sm text-black/45">Nenhum prazo cadastrado.</p>
        ) : null}
      </div>
    </div>
  );
}
