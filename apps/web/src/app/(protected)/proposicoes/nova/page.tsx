'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';

interface Councilor {
  id: string;
  displayName: string;
  party?: string;
  active: boolean;
}
interface InboxDocument {
  id: string;
  originalName: string;
  pageCount?: number;
  securityStatus: string;
  processingStatus: string;
}

export default function NewPropositionPage() {
  const router = useRouter();
  const [councilors, setCouncilors] = useState<Councilor[]>([]);
  const [documents, setDocuments] = useState<InboxDocument[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [primaryDocument, setPrimaryDocument] = useState('');
  const [type, setType] = useState<'REQUEST' | 'INDICATION'>('REQUEST');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<Councilor[]>('/councilors'),
      apiFetch<InboxDocument[]>('/documents/operational-inbox'),
    ])
      .then(([nextCouncilors, nextDocuments]) => {
        setCouncilors(nextCouncilors.filter(({ active }) => active));
        setDocuments(
          nextDocuments.filter(
            ({ securityStatus, processingStatus }) =>
              securityStatus === 'CLEAN' && processingStatus === 'COMPLETED',
          ),
        );
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!authors.length || !selectedDocuments.length || !primaryDocument) {
      setError('Selecione ao menos um autor e um documento principal.');
      return;
    }
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const proposition = await apiFetch<{ id: string }>('/propositions', {
        method: 'POST',
        body: JSON.stringify({
          type,
          number: Number(data.get('number')),
          year: Number(data.get('year')),
          protocolNumber: data.get('protocolNumber') || undefined,
          protocolDate: data.get('protocolDate'),
          recipient: data.get('recipient') || undefined,
          subject: data.get('subject'),
          summary: data.get('summary') || undefined,
          authors: authors.map((councilorId, index) => ({
            councilorId,
            role: index === 0 ? 'PRIMARY' : 'COAUTHOR',
          })),
          documents: selectedDocuments.map((documentId, index) => ({
            documentId,
            role: documentId === primaryDocument ? 'PRIMARY' : 'ATTACHMENT',
            sortOrder: index,
          })),
        }),
      });
      router.push(`/proposicoes/${proposition.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao criar proposição.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm font-semibold text-brand-600">Cadastro manual</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Nova proposição</h1>
      <p className="mt-2 text-sm text-black/50">
        Vincule arquivos já processados; nenhum PDF será copiado novamente.
      </p>
      <form onSubmit={submit} className="mt-7 space-y-6">
        <section className="card grid gap-5 p-6 md:grid-cols-2">
          <label className="text-sm font-medium">
            Tipo
            <select
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
              value={type}
              onChange={(event) => setType(event.target.value as 'REQUEST' | 'INDICATION')}
            >
              <option value="REQUEST">Requerimento</option>
              <option value="INDICATION">Indicação</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Número
            <input
              required
              name="number"
              type="number"
              min="1"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Ano
            <input
              required
              name="year"
              type="number"
              min="1900"
              max="2200"
              defaultValue={new Date().getFullYear()}
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Data do protocolo
            <input
              required
              name="protocolDate"
              type="date"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Número do protocolo
            <input
              name="protocolNumber"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            Destinatário
            <input
              name="recipient"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium md:col-span-2">
            Assunto
            <input
              required
              name="subject"
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium md:col-span-2">
            Resumo administrativo
            <textarea
              name="summary"
              rows={3}
              className="mt-2 w-full rounded-xl border border-black/10 px-3 py-3"
            />
          </label>
        </section>
        <section className="card p-6">
          <h2 className="font-semibold">Autores</h2>
          <p className="mt-1 text-xs text-black/45">
            O primeiro selecionado será o autor principal; os demais serão coautores.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {councilors.map((councilor) => (
              <label
                key={councilor.id}
                className="flex items-center gap-3 rounded-xl border border-black/8 p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={authors.includes(councilor.id)}
                  onChange={() => toggle(authors, councilor.id, setAuthors)}
                />{' '}
                <span>
                  {councilor.displayName}
                  {councilor.party ? ` · ${councilor.party}` : ''}
                </span>
              </label>
            ))}
          </div>
          {!councilors.length ? (
            <p className="mt-4 text-sm text-black/45">
              Cadastre vereadores antes de criar a proposição.
            </p>
          ) : null}
        </section>
        <section className="card p-6">
          <h2 className="font-semibold">Documentos processados</h2>
          <p className="mt-1 text-xs text-black/45">
            Marque os arquivos e escolha exatamente um como principal.
          </p>
          <div className="mt-4 space-y-2">
            {documents.map((document) => {
              const selected = selectedDocuments.includes(document.id);
              return (
                <div
                  key={document.id}
                  className="flex items-center gap-4 rounded-xl border border-black/8 p-3 text-sm"
                >
                  <input
                    aria-label="Selecionar documento"
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const next = selected
                        ? selectedDocuments.filter((id) => id !== document.id)
                        : [...selectedDocuments, document.id];
                      setSelectedDocuments(next);
                      if (selected && primaryDocument === document.id) setPrimaryDocument('');
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {document.originalName} · {document.pageCount ?? 0} pág.
                  </span>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      disabled={!selected}
                      type="radio"
                      name="primary-document"
                      checked={primaryDocument === document.id}
                      onChange={() => setPrimaryDocument(document.id)}
                    />{' '}
                    Principal
                  </label>
                </div>
              );
            })}
          </div>
          {!documents.length ? (
            <p className="mt-4 rounded-xl bg-amber/10 p-4 text-sm text-amber">
              Não há documentos CLEAN e concluídos pendentes. Faça o upload e aguarde o worker.
            </p>
          ) : null}
        </section>
        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button disabled={saving} className="button-primary disabled:opacity-50">
            {saving ? 'Salvando…' : 'Criar proposição e prazo'}
          </button>
        </div>
      </form>
    </div>
  );
}
