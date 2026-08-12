'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface IdentityItem {
  id: string;
  phoneMasked: string;
  instance: string;
  active: boolean;
  verifiedAt: string | null;
  createdAt: string;
  councilor: {
    id: string;
    displayName: string;
    active: boolean;
    user: { id: string; email: string; status: string } | null;
  };
  conversationCount?: number;
  notificationCount?: number;
  lastInteraction: string | null;
}

interface Overview {
  items: IdentityItem[];
  pendingAnswers: number;
}

export default function WhatsappPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    return apiFetch<Overview>('/integrations/whatsapp/overview')
      .then(setData)
      .catch((caught: Error) => setError(caught.message));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function verify(identity: IdentityItem) {
    if (!window.confirm(`Verificar e ativar a identidade ${identity.phoneMasked}?`)) return;
    try {
      await apiFetch(`/integrations/whatsapp/identities/${identity.id}/verify`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao verificar.');
    }
  }

  async function deactivate(identity: IdentityItem) {
    if (!window.confirm(`Desativar a identidade ${identity.phoneMasked}?`)) return;
    try {
      await apiFetch(`/integrations/whatsapp/identities/${identity.id}/deactivate`, {
        method: 'POST',
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao desativar.');
    }
  }

  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Integração de canal</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em]">WhatsApp</h1>
          <p className="mt-2 text-sm text-black/50">
            Identidades verificadas, sessões temporárias e fila de respostas pendentes.
          </p>
        </div>
      </div>
      {error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
            Identidades ativas
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {data?.items.filter((item) => item.active).length ?? '—'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
            Verificadas
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {data?.items.filter((item) => item.verifiedAt).length ?? '—'}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
            Respostas pendentes
          </p>
          <p className="mt-2 text-3xl font-semibold">{data?.pendingAnswers ?? '—'}</p>
        </div>
      </div>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[.02] text-xs uppercase text-black/45">
            <tr>
              <th className="px-5 py-4">Telefone</th>
              <th className="px-5 py-4">Instância</th>
              <th className="px-5 py-4">Vereador</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4">Última atividade</th>
              <th className="px-5 py-4">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {data?.items.map((identity) => (
              <tr key={identity.id}>
                <td className="px-5 py-4 font-medium">{identity.phoneMasked}</td>
                <td className="px-5 py-4 text-black/60">{identity.instance}</td>
                <td className="px-5 py-4">
                  <p className="font-medium">{identity.councilor.displayName}</p>
                  <p className="mt-0.5 text-xs text-black/45">
                    {identity.councilor.user?.email ?? 'Sem usuário vinculado'}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${identity.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
                    >
                      {identity.active ? 'Ativa' : 'Inativa'}
                    </span>
                    {identity.verifiedAt ? (
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                        Verificada
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        Não verificada
                      </span>
                    )}
                    {identity.councilor.user?.status !== 'ACTIVE' ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        Usuário não ativo
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-5 py-4 text-black/60">
                  {identity.lastInteraction
                    ? new Date(identity.lastInteraction).toLocaleString('pt-BR')
                    : 'Sem sessão ativa'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    {!identity.verifiedAt ? (
                      <button
                        onClick={() => verify(identity)}
                        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Verificar
                      </button>
                    ) : null}
                    {identity.active ? (
                      <button
                        onClick={() => deactivate(identity)}
                        className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
                      >
                        Desativar
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.items.length ? (
          <p className="p-10 text-center text-sm text-black/45">
            Nenhuma identidade WhatsApp cadastrada. Cadastre em Vereadores e verifique o número para
            liberar consultas.
          </p>
        ) : null}
      </div>
    </div>
  );
}
