'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface NotificationItem {
  id: string;
  type: string;
  channel: string;
  template: string;
  templateVersion: string | null;
  status: string;
  attempts: number;
  externalMessageId: string | null;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  recipient: { userId: string; email: string; name: string } | null;
  identity: { identityId: string; phoneMasked: string; instance: string } | null;
}

interface NotificationList {
  items: NotificationItem[];
  nextCursor: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  WHATSAPP_CONVERSATION_REPLY: 'Resposta de conversa',
  RESPONSE_ANALYSIS_COMPLETED: 'Resposta analisada',
  DEADLINE_APPROACHING: 'Prazo próximo',
  DEADLINE_EXPIRED: 'Prazo vencido',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  PROCESSING: 'Em processamento',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
};

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ limit: '100' });
    if (type) query.set('type', type);
    if (status) query.set('status', status);
    return apiFetch<NotificationList>(`/notifications?${query}`)
      .then((result) => setItems(result.items))
      .catch((caught: Error) => setError(caught.message));
  }, [type, status]);
  useEffect(() => {
    void load();
  }, [load]);

  async function retry(item: NotificationItem) {
    if (!window.confirm('Reenviar esta notificação?')) return;
    try {
      await apiFetch(`/notifications/${item.id}/retry`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao reenviar.');
    }
  }

  async function cancel(item: NotificationItem) {
    if (!window.confirm('Cancelar esta notificação antes do envio?')) return;
    try {
      await apiFetch(`/notifications/${item.id}/cancel`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao cancelar.');
    }
  }

  const retriable = (item: NotificationItem) =>
    item.status === 'FAILED' || item.status === 'PENDING';
  const cancellable = (item: NotificationItem) =>
    item.status === 'PENDING' || item.status === 'PROCESSING';

  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Canal e entrega</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em]">Notificações</h1>
          <p className="mt-2 text-sm text-black/50">
            Histórico de entregas, tentativas e callbacks de status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos os tipos</option>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
            aria-label="Filtrar por status"
          >
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="card mt-7 overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[.02] text-xs uppercase text-black/45">
            <tr>
              <th className="px-5 py-4">Tipo</th>
              <th className="px-5 py-4">Destinatário</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Tentativas</th>
              <th className="px-5 py-4">Enviada em</th>
              <th className="px-5 py-4">ID externo</th>
              <th className="px-5 py-4">Erro</th>
              <th className="px-5 py-4">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-4 font-medium">{TYPE_LABEL[item.type] ?? item.type}</td>
                <td className="px-5 py-4">
                  {item.identity ? (
                    <span>
                      {item.identity.phoneMasked}
                      <span className="ml-1.5 text-xs text-black/40">{item.identity.instance}</span>
                    </span>
                  ) : item.recipient ? (
                    item.recipient.email
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.status === 'DELIVERED'
                        ? 'bg-emerald-50 text-emerald-700'
                        : item.status === 'FAILED'
                          ? 'bg-red-50 text-red-700'
                          : item.status === 'CANCELLED'
                            ? 'bg-black/5 text-black/45'
                            : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-black/60">{item.attempts}</td>
                <td className="px-5 py-4 text-black/60">
                  {item.sentAt
                    ? new Date(item.sentAt).toLocaleString('pt-BR')
                    : item.createdAt
                      ? new Date(item.createdAt).toLocaleString('pt-BR')
                      : '—'}
                </td>
                <td className="px-5 py-4 font-mono text-xs text-black/55">
                  {item.externalMessageId ?? '—'}
                </td>
                <td className="max-w-[220px] px-5 py-4 text-xs text-red-700">
                  {item.lastError ? item.lastError : '—'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    {retriable(item) ? (
                      <button
                        onClick={() => retry(item)}
                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Reenviar
                      </button>
                    ) : null}
                    {cancellable(item) ? (
                      <button
                        onClick={() => cancel(item)}
                        className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
                      >
                        Cancelar
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length ? (
          <p className="p-10 text-center text-sm text-black/45">
            Nenhuma notificação para os filtros selecionados.
          </p>
        ) : null}
      </div>
    </div>
  );
}
