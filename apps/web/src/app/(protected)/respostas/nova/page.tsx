'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { propositionTypeLabel } from '../../../../lib/legislative';

interface Proposition {
  id: string;
  type: 'REQUEST' | 'INDICATION';
  number: number;
  year: number;
  subject: string;
}
interface DocumentItem {
  id: string;
  originalName: string;
  securityStatus: string;
  processingStatus: string;
}

export default function NewResponsePage() {
  const router = useRouter();
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([
      apiFetch<{ items: Proposition[] }>('/propositions?limit=100'),
      apiFetch<DocumentItem[]>('/documents/operational-inbox'),
    ])
      .then(([props, docs]) => {
        setPropositions(props.items);
        setDocuments(
          docs.filter(
            (doc) => doc.securityStatus === 'CLEAN' && doc.processingStatus === 'COMPLETED',
          ),
        );
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!primary) {
      setError('Escolha o documento principal.');
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<{ proposition?: { id: string } }>('/responses', {
        method: 'POST',
        body: JSON.stringify({
          propositionId: data.get('propositionId') || undefined,
          type: data.get('type'),
          protocolNumber: data.get('protocolNumber') || undefined,
          protocolDate: data.get('protocolDate') || undefined,
          sender: data.get('sender') || undefined,
          subject: data.get('subject') || undefined,
          documents: selected.map((documentId, index) => ({
            documentId,
            role: documentId === primary ? 'PRIMARY' : 'ATTACHMENT',
            sortOrder: index,
          })),
        }),
      });
      router.push(
        result.proposition?.id ? `/proposicoes/${result.proposition.id}` : '/associacoes',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao cadastrar resposta.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-sm font-semibold text-brand-600">Cadastro administrativo</p>
      <h1 className="mt-1 text-3xl font-semibold">Nova resposta</h1>
      <p className="mt-2 text-sm text-black/50">
        A associação pode ser informada ou calculada por sinais determinísticos.
      </p>
      <form onSubmit={submit} className="mt-7 space-y-6">
        <section className="card grid gap-5 p-6 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Tipo
            <select
              required
              name="type"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            >
              <option value="INITIAL">Resposta inicial</option>
              <option value="COMPLEMENTARY">Resposta complementar</option>
              <option value="RECTIFICATION">Retificação</option>
              <option value="OTHER">Outro</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Proposição (opcional)
            <select
              name="propositionId"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            >
              <option value="">Detectar associação</option>
              {propositions.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {propositionTypeLabel[prop.type]} {prop.number}/{prop.year} · {prop.subject}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Protocolo
            <input
              name="protocolNumber"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Data
            <input
              name="protocolDate"
              type="date"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Remetente
            <input
              name="sender"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Assunto
            <input
              name="subject"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
        </section>
        <section className="card p-6">
          <h2 className="font-semibold">Documentos</h2>
          <div className="mt-4 space-y-2">
            {documents.map((document) => {
              const checked = selected.includes(document.id);
              return (
                <div
                  key={document.id}
                  className="flex items-center gap-4 rounded-xl border border-black/8 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? selected.filter((id) => id !== document.id)
                        : [...selected, document.id];
                      setSelected(next);
                      if (checked && primary === document.id) setPrimary('');
                    }}
                  />
                  <span className="flex-1 truncate">{document.originalName}</span>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="radio"
                      disabled={!checked}
                      checked={primary === document.id}
                      onChange={() => setPrimary(document.id)}
                    />
                    Principal
                  </label>
                </div>
              );
            })}
          </div>
          {!documents.length ? (
            <p className="mt-4 text-sm text-black/45">Nenhum documento processado pendente.</p>
          ) : null}
        </section>
        {error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end">
          <button disabled={saving} className="button-primary disabled:opacity-50">
            {saving ? 'Salvando…' : 'Cadastrar resposta'}
          </button>
        </div>
      </form>
    </div>
  );
}
