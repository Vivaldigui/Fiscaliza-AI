'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api';
import {
  formatBytes,
  processingLabels,
  statusTone,
  type DocumentListResponse,
} from '../../../lib/documents';

interface UserIdentity {
  roles: string[];
}

const activeStatuses = new Set([
  'RECEIVED',
  'QUARANTINED',
  'SECURITY_SCAN',
  'EXTRACTING',
  'OCR',
  'CHUNKING',
]);

export default function DocumentsPage() {
  const [data, setData] = useState<DocumentListResponse>({
    items: [],
    total: 0,
    page: 1,
    limit: 25,
  });
  const [status, setStatus] = useState('');
  const [security, setSecurity] = useState('');
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (security) search.set('securityStatus', security);
    if (review) search.set('reviewRequired', review);
    return search.toString();
  }, [review, security, status]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setData(await apiFetch<DocumentListResponse>(`/documents${query ? `?${query}` : ''}`));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Falha ao listar documentos.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void apiFetch<UserIdentity>('/auth/me').then((user) => setRoles(user.roles));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!data.items.some((item) => activeStatuses.has(item.processingStatus))) return;
    const timer = window.setInterval(() => void load(true), 4_000);
    return () => window.clearInterval(timer);
  }, [data.items, load]);

  const canManage = roles.includes('ADMIN') || roles.includes('SECRETARIAT');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ documentId: string; duplicate: boolean }>('/documents', {
        method: 'POST',
        body: data,
      });
      setNotice(
        result.duplicate
          ? 'Este PDF já existia. Nenhuma segunda cópia foi criada.'
          : 'PDF recebido e colocado em quarentena. O processamento continuará em segundo plano.',
      );
      form.reset();
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao enviar PDF.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1480px]">
      <div>
        <p className="text-sm font-semibold text-brand-600">Operação documental</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em] sm:text-4xl">Documentos</h1>
        <p className="mt-2 text-sm text-black/50">
          Acompanhe quarentena, segurança, extração página a página e OCR.
        </p>
      </div>

      {canManage ? (
        <form
          className="card mt-7 flex flex-col gap-4 p-5 sm:flex-row sm:items-end"
          onSubmit={upload}
        >
          <div className="flex-1">
            <label className="mb-2 block text-sm font-medium" htmlFor="document-file">
              Enviar PDF
            </label>
            <input
              className="input file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700"
              id="document-file"
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
            />
          </div>
          <button className="button-primary sm:min-w-36" disabled={uploading} type="submit">
            {uploading ? 'Enviando…' : 'Enviar PDF'}
          </button>
        </form>
      ) : null}

      {notice ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section className="card mt-6 overflow-hidden">
        <div className="grid gap-3 border-b border-black/5 p-4 sm:grid-cols-3 sm:p-5">
          <label className="text-xs font-medium text-black/55">
            Processamento
            <select
              className="input mt-1.5"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Todos</option>
              {Object.entries(processingLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-black/55">
            Segurança
            <select
              className="input mt-1.5"
              value={security}
              onChange={(event) => setSecurity(event.target.value)}
            >
              <option value="">Todos</option>
              {['PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'SKIPPED', 'FAILED'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-black/55">
            Revisão
            <select
              className="input mt-1.5"
              value={review}
              onChange={(event) => setReview(event.target.value)}
            >
              <option value="">Todos</option>
              <option value="true">Precisa de revisão</option>
              <option value="false">Sem revisão pendente</option>
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-black/[.025] text-xs uppercase tracking-wide text-black/45">
              <tr>
                <th className="px-5 py-3 font-semibold">Documento</th>
                <th className="px-5 py-3 font-semibold">Recebido</th>
                <th className="px-5 py-3 font-semibold">Páginas</th>
                <th className="px-5 py-3 font-semibold">Processamento</th>
                <th className="px-5 py-3 font-semibold">Segurança</th>
                <th className="px-5 py-3 font-semibold">OCR</th>
                <th className="px-5 py-3 font-semibold">
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {data.items.map((item) => (
                <tr key={item.id} className="hover:bg-black/[.015]">
                  <td className="max-w-xs px-5 py-4">
                    <p className="truncate font-medium">{item.originalName}</p>
                    <p className="mt-1 text-xs text-black/40">{formatBytes(item.sizeBytes)}</p>
                  </td>
                  <td className="px-5 py-4 text-black/55">
                    {new Date(item.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-5 py-4">{item.pageCount ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.processingStatus)}`}
                    >
                      {processingLabels[item.processingStatus] ?? item.processingStatus}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.securityStatus)}`}
                    >
                      {item.securityStatus}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs font-medium">{item.ocrStatus}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      className="font-semibold text-brand-600 hover:underline"
                      href={`/documentos/${item.id}`}
                    >
                      Abrir →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && data.items.length === 0 ? (
          <p className="p-10 text-center text-sm text-black/45">
            Nenhum documento corresponde aos filtros.
          </p>
        ) : null}
        {loading ? (
          <p className="p-10 text-center text-sm text-black/45">Carregando documentos…</p>
        ) : null}
        <div className="border-t border-black/5 px-5 py-3 text-xs text-black/45">
          {data.total} documento(s)
        </div>
      </section>
    </div>
  );
}
