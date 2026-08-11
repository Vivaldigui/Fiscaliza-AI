'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import {
  INDICATION_ITEM_STATUSES,
  REQUEST_ITEM_STATUSES,
  analysisStatusLabel,
  itemStatusIcon,
  itemStatusLabel,
  itemStatusTone,
} from '../../lib/analysis';

interface AnalysisSummary {
  id: string;
  type: string;
  status: string;
  confidence: string | number | null;
  createdAt: string;
  completedAt: string | null;
  _count: { items: number; evidences: number };
}

interface Evidence {
  id: string;
  documentId: string;
  pageNumber: number;
  kind: string;
  excerpt: string | null;
  reason: string;
}

interface AnalysisItem {
  id: string;
  requestedItemId: string | null;
  requestedItem: { originalText: string; normalizedQuestion: string; sequence: number } | null;
  originalStatus: string;
  currentStatus: string;
  originalExplanation: string;
  currentExplanation: string;
  confidence: string | number;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  evidences: Evidence[];
  revisions: Array<{
    id: string;
    previousStatus: string;
    newStatus: string;
    justification: string;
    createdAt: string;
    changedBy: { name: string };
  }>;
}

interface AnalysisDetail {
  id: string;
  type: string;
  status: string;
  confidence: string | number | null;
  executiveSummary: {
    summary: string;
    mainFindings: Array<{ text: string }>;
    pendingItems: string[];
  } | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  items: AnalysisItem[];
}

interface UserIdentity {
  roles: string[];
}

export function AnalysisPanel({
  propositionId,
  propositionType,
}: {
  propositionId: string;
  propositionType: string;
}) {
  const [history, setHistory] = useState<AnalysisSummary[]>([]);
  const [selected, setSelected] = useState<AnalysisDetail | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const items = await apiFetch<AnalysisSummary[]>(`/propositions/${propositionId}/analyses`);
    setHistory(items);
    return items;
  }, [propositionId]);

  const loadDetail = useCallback(async (analysisId: string) => {
    const detail = await apiFetch<AnalysisDetail>(`/analyses/${analysisId}`);
    setSelected(detail);
  }, []);

  useEffect(() => {
    void Promise.all([
      loadHistory().then((items) => {
        if (items[0]) void loadDetail(items[0].id);
      }),
      apiFetch<UserIdentity>('/auth/me').then((user) => setRoles(user.roles)),
    ]).catch((caught: Error) => setError(caught.message));
  }, [loadHistory, loadDetail]);

  useEffect(() => {
    if (!selected) return;
    if (selected.status !== 'PENDING' && selected.status !== 'PROCESSING') return;
    const timer = window.setInterval(() => void loadDetail(selected.id), 4_000);
    return () => window.clearInterval(timer);
  }, [selected, loadDetail]);

  const canManage = roles.includes('ADMIN') || roles.includes('SECRETARIAT');

  async function runAnalysis(reanalyzeId?: string) {
    setBusy(true);
    setError(null);
    try {
      const created = reanalyzeId
        ? await apiFetch<AnalysisDetail>(`/analyses/${reanalyzeId}/reanalyze`, { method: 'POST' })
        : await apiFetch<AnalysisDetail>(`/propositions/${propositionId}/analyses`, {
            method: 'POST',
          });
      await loadHistory();
      await loadDetail(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível executar a análise.');
    } finally {
      setBusy(false);
    }
  }

  async function openEvidence(documentId: string, pageNumber: number) {
    try {
      const { url } = await apiFetch<{ url: string }>(`/documents/${documentId}/download`);
      window.open(`${url}#page=${pageNumber}`, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Documento indisponível.');
    }
  }

  async function submitReview(
    item: AnalysisItem,
    newStatus: string,
    newExplanation: string,
    justification: string,
  ) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/analyses/${selected.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ analysisItemId: item.id, newStatus, newExplanation, justification }),
      });
      await loadDetail(selected.id);
      setReviewing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar a revisão.');
    } finally {
      setBusy(false);
    }
  }

  const counts = selected
    ? selected.items.reduce<Record<string, number>>((accumulator, item) => {
        accumulator[item.currentStatus] = (accumulator[item.currentStatus] ?? 0) + 1;
        return accumulator;
      }, {})
    : {};

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Análise por IA</h2>
        {canManage ? (
          <div className="flex gap-2">
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => void runAnalysis()}
            >
              Executar análise
            </button>
            {selected ? (
              <button
                type="button"
                className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={busy}
                onClick={() => void runAnalysis(selected.id)}
              >
                Analisar novamente
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

      {history.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {history.map((analysis, index) => (
            <button
              key={analysis.id}
              type="button"
              onClick={() => void loadDetail(analysis.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                selected?.id === analysis.id
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-black/10 hover:bg-black/5'
              }`}
            >
              Análise {history.length - index} ·{' '}
              {analysisStatusLabel[analysis.status] ?? analysis.status}
            </button>
          ))}
        </div>
      ) : null}

      {!history.length && !busy ? (
        <p className="mt-4 rounded-xl bg-black/[.025] p-5 text-sm text-black/45">
          Nenhuma análise executada ainda.
        </p>
      ) : null}

      {selected ? (
        <div className="mt-5 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${itemStatusTone(selected.status === 'COMPLETED' ? 'ANSWERED' : selected.status === 'NEEDS_HUMAN_REVIEW' ? 'NEEDS_HUMAN_REVIEW' : 'NOT_ANSWERED')}`}
            >
              {analysisStatusLabel[selected.status] ?? selected.status}
            </span>
            <span className="text-xs text-black/45">
              {Object.entries(counts)
                .map(([status, count]) => `${count} ${itemStatusLabel[status] ?? status}`)
                .join(' · ')}
            </span>
          </div>

          {selected.failureReason ? (
            <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {selected.failureReason}
            </p>
          ) : null}

          {selected.executiveSummary ? (
            <div className="rounded-xl bg-black/[.025] p-5">
              <h3 className="text-sm font-semibold">Resumo executivo</h3>
              <p className="mt-2 text-sm text-black/70">{selected.executiveSummary.summary}</p>
              {selected.executiveSummary.pendingItems.length ? (
                <ul className="mt-3 list-inside list-disc text-sm text-black/60">
                  {selected.executiveSummary.pendingItems.map((pending, index) => (
                    <li key={index}>{pending}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-4">
            {selected.items.map((item) => (
              <article key={item.id} className="rounded-xl border border-black/8 p-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-black/45">
                      Item {item.requestedItem?.sequence ?? '—'} · solicitação
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {item.requestedItem?.originalText ?? 'Item removido.'}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${itemStatusTone(item.currentStatus)}`}
                      >
                        <span aria-hidden>{itemStatusIcon[item.currentStatus] ?? '•'}</span>
                        {itemStatusLabel[item.currentStatus] ?? item.currentStatus}
                      </span>
                      <span className="text-xs text-black/45">
                        confiança {Number(item.confidence).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-black/70">{item.currentExplanation}</p>
                    {item.reviewedById ? (
                      <p className="mt-2 text-xs text-brand-700">
                        Revisado por humano em{' '}
                        {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString('pt-BR') : ''}.
                        {item.reviewReason ? ` Motivo: ${item.reviewReason}` : ''}
                      </p>
                    ) : null}
                  </div>
                </div>

                {item.evidences.length ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium text-black/45">Evidências</p>
                    {item.evidences.map((evidence) => (
                      <button
                        key={evidence.id}
                        type="button"
                        onClick={() => void openEvidence(evidence.documentId, evidence.pageNumber)}
                        className="block w-full rounded-lg border border-black/8 p-3 text-left text-xs hover:border-brand-300"
                      >
                        <span className="font-semibold text-brand-700">
                          Página {evidence.pageNumber} →
                        </span>{' '}
                        {evidence.excerpt
                          ? `“${evidence.excerpt}”`
                          : '(referência visual, sem trecho)'}
                        <span className="mt-1 block text-black/45">{evidence.reason}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-black/40">
                    Sem evidência positiva — conclusão de ausência com base na cobertura documental
                    examinada.
                  </p>
                )}

                {canManage ? (
                  reviewing === item.id ? (
                    <ReviewForm
                      item={item}
                      propositionType={propositionType}
                      busy={busy}
                      onCancel={() => setReviewing(null)}
                      onSubmit={(status, explanation, justification) =>
                        void submitReview(item, status, explanation, justification)
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="mt-4 text-xs font-semibold text-brand-600 hover:underline"
                      onClick={() => setReviewing(item.id)}
                    >
                      Revisar manualmente
                    </button>
                  )
                ) : null}

                {item.revisions.length ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-semibold text-black/45">
                      Histórico de revisão ({item.revisions.length})
                    </summary>
                    <ul className="mt-2 space-y-2 text-xs text-black/55">
                      {item.revisions.map((revision) => (
                        <li key={revision.id}>
                          {new Date(revision.createdAt).toLocaleString('pt-BR')} ·{' '}
                          {revision.changedBy.name}: {itemStatusLabel[revision.previousStatus]} →{' '}
                          {itemStatusLabel[revision.newStatus]} — {revision.justification}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewForm({
  item,
  propositionType,
  busy,
  onCancel,
  onSubmit,
}: {
  item: AnalysisItem;
  propositionType: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (status: string, explanation: string, justification: string) => void;
}) {
  const [status, setStatus] = useState(item.currentStatus);
  const [explanation, setExplanation] = useState(item.currentExplanation);
  const [justification, setJustification] = useState('');
  const statuses = propositionType === 'REQUEST' ? REQUEST_ITEM_STATUSES : INDICATION_ITEM_STATUSES;

  return (
    <form
      className="mt-4 space-y-3 rounded-xl bg-black/[.025] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(status, explanation, justification);
      }}
    >
      <div>
        <label className="text-xs font-medium text-black/45" htmlFor={`status-${item.id}`}>
          Novo status
        </label>
        <select
          id={`status-${item.id}`}
          className="mt-1 w-full rounded-lg border border-black/10 p-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {itemStatusLabel[value] ?? value}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-black/45" htmlFor={`explanation-${item.id}`}>
          Nova explicação
        </label>
        <textarea
          id={`explanation-${item.id}`}
          className="mt-1 w-full rounded-lg border border-black/10 p-2 text-sm"
          rows={3}
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-black/45" htmlFor={`justification-${item.id}`}>
          Justificativa da revisão
        </label>
        <textarea
          id={`justification-${item.id}`}
          className="mt-1 w-full rounded-lg border border-black/10 p-2 text-sm"
          rows={2}
          required
          minLength={3}
          value={justification}
          onChange={(event) => setJustification(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="button-primary" disabled={busy}>
          Salvar revisão
        </button>
        <button
          type="button"
          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
