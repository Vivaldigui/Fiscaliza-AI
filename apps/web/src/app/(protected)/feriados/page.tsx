'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatDate } from '../../../lib/legislative';

interface Holiday {
  id: string;
  date: string;
  name: string;
  scope: string;
  active: boolean;
}
const scopeLabel: Record<string, string> = {
  NATIONAL: 'Nacional',
  STATE: 'Estadual',
  MUNICIPAL: 'Municipal',
  INSTITUTIONAL: 'Institucional',
};

export default function HolidaysPage() {
  const [items, setItems] = useState<Holiday[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiFetch<Holiday[]>('/holidays')
        .then(setItems)
        .catch((caught: Error) => setError(caught.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await apiFetch('/holidays', {
        method: 'POST',
        body: JSON.stringify({
          date: data.get('date'),
          name: data.get('name'),
          scope: data.get('scope'),
          timezone: 'America/Sao_Paulo',
        }),
      });
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao cadastrar feriado.');
    }
  }
  async function toggle(item: Holiday) {
    try {
      await apiFetch(`/holidays/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao atualizar.');
    }
  }
  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold text-brand-600">Calendário administrativo</p>
      <h1 className="mt-1 text-3xl font-semibold">Feriados</h1>
      <p className="mt-2 text-sm text-black/50">
        Não há download automático: cada data é cadastrada e auditada.
      </p>
      <form
        onSubmit={create}
        className="card mt-7 grid gap-4 p-5 sm:grid-cols-[160px_1fr_180px_auto]"
      >
        <input
          required
          name="date"
          type="date"
          className="rounded-xl border border-black/10 px-3 py-3 text-sm"
        />
        <input
          required
          name="name"
          placeholder="Nome do feriado"
          className="rounded-xl border border-black/10 px-3 py-3 text-sm"
        />
        <select name="scope" className="rounded-xl border border-black/10 px-3 py-3 text-sm">
          <option value="MUNICIPAL">Municipal</option>
          <option value="STATE">Estadual</option>
          <option value="NATIONAL">Nacional</option>
          <option value="INSTITUTIONAL">Institucional</option>
        </select>
        <button className="button-primary">Adicionar</button>
      </form>
      {error ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="card mt-5 divide-y divide-black/5">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center justify-between gap-4 p-4 ${item.active ? '' : 'opacity-45'}`}
          >
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="mt-1 text-xs text-black/45">
                {formatDate(item.date)} · {scopeLabel[item.scope] ?? item.scope}
              </p>
            </div>
            <button
              onClick={() => toggle(item)}
              className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold"
            >
              {item.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
        {!items.length ? (
          <p className="p-8 text-center text-sm text-black/45">Nenhum feriado cadastrado.</p>
        ) : null}
      </div>
    </div>
  );
}
