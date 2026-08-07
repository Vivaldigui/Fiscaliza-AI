'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { propositionTypeLabel } from '../../../lib/legislative';

interface Candidate {
  id: string;
  propositionId: string;
  score: string | number;
  signalScores: Record<string, unknown>;
  rank: number;
  status: string;
  proposition: {
    id: string;
    type: 'REQUEST' | 'INDICATION';
    number: number;
    year: number;
    subject: string;
    authors: Array<{ councilor: { displayName: string } }>;
  };
}
interface PendingResponse {
  id: string;
  associationVersion: number;
  subject?: string;
  protocolNumber?: string;
  documents: Array<{ document: { originalName: string } }>;
  associationEvaluations: Array<{
    id: string;
    topScore?: string;
    secondScore?: string;
    margin?: string;
    configurationSnapshot: { reason?: string };
    candidates: Candidate[];
  }>;
}

export default function AssociationsPage() {
  const [items, setItems] = useState<PendingResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      apiFetch<PendingResponse[]>('/associations/pending')
        .then(setItems)
        .catch((caught: Error) => setError(caught.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function confirm(response: PendingResponse, candidate: Candidate) {
    const reason = window.prompt('Justificativa da confirmação manual:');
    if (!reason) return;
    try {
      await apiFetch(`/associations/responses/${response.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          propositionId: candidate.propositionId,
          expectedVersion: response.associationVersion,
          reason,
        }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na associação.');
    }
  }
  async function reject(response: PendingResponse, candidate: Candidate) {
    const reason = window.prompt('Motivo da rejeição da sugestão:');
    if (!reason) return;
    try {
      await apiFetch(`/associations/responses/${response.id}/candidates/${candidate.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: response.associationVersion, reason }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha na revisão.');
    }
  }
  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-sm font-semibold text-brand-600">Revisão humana</p>
      <h1 className="mt-1 text-3xl font-semibold">Associações pendentes</h1>
      <p className="mt-2 text-sm text-black/50">
        O sistema nunca escolhe silenciosamente quando o limiar ou a margem não são atendidos.
      </p>
      {error ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="mt-7 space-y-5">
        {items.map((response) => {
          const evaluation = response.associationEvaluations[0];
          return (
            <section className="card p-6" key={response.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">
                    {response.subject ??
                      response.documents.map(({ document }) => document.originalName).join(', ')}
                  </h2>
                  <p className="mt-1 text-xs text-black/45">
                    Protocolo {response.protocolNumber ?? 'não informado'}
                  </p>
                </div>
                <span className="rounded-full bg-amber/10 px-3 py-1 text-xs font-semibold text-amber">
                  Revisão necessária
                </span>
              </div>
              {evaluation ? (
                <>
                  <p className="mt-4 rounded-xl bg-black/[.025] p-3 text-xs text-black/55">
                    {evaluation.configurationSnapshot.reason ?? 'Associação inconclusiva.'} · melhor{' '}
                    {Number(evaluation.topScore ?? 0).toFixed(2)} · segundo{' '}
                    {Number(evaluation.secondScore ?? 0).toFixed(2)} · margem{' '}
                    {Number(evaluation.margin ?? 0).toFixed(2)}
                  </p>
                  <div className="mt-4 space-y-3">
                    {evaluation.candidates
                      .filter(({ status }) => status !== 'REJECTED')
                      .map((candidate) => {
                        const explanations = Array.isArray(candidate.signalScores.explanations)
                          ? (candidate.signalScores.explanations as string[])
                          : [];
                        return (
                          <article
                            key={candidate.id}
                            className="rounded-xl border border-black/8 p-4"
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold">
                                  #{candidate.rank} ·{' '}
                                  {propositionTypeLabel[candidate.proposition.type]}{' '}
                                  {candidate.proposition.number}/{candidate.proposition.year}
                                </p>
                                <p className="mt-1 text-sm text-black/60">
                                  {candidate.proposition.subject}
                                </p>
                                <p className="mt-1 text-xs text-black/40">
                                  {candidate.proposition.authors
                                    .map(({ councilor }) => councilor.displayName)
                                    .join(', ')}
                                </p>
                                <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-black/50">
                                  {explanations.map((text) => (
                                    <li key={text}>{text}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-2xl font-semibold">
                                  {Number(candidate.score).toFixed(2)}
                                </p>
                                <div className="mt-3 flex gap-2">
                                  <button
                                    onClick={() => reject(response, candidate)}
                                    className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5"
                                  >
                                    Rejeitar
                                  </button>
                                  <button
                                    onClick={() => confirm(response, candidate)}
                                    className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                                  >
                                    Confirmar
                                  </button>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-black/45">Nenhuma avaliação disponível.</p>
              )}
            </section>
          );
        })}
        {!items.length && !error ? (
          <div className="card p-10 text-center text-sm text-black/45">
            Nenhuma associação pendente.
          </div>
        ) : null}
      </div>
    </div>
  );
}
