'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface Source {
  documentId: string;
  documentPageId: string;
  pageNumber: number;
  excerpt?: string;
}

interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM_EVENT';
  content: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | null;
  sources: Source[];
  provider?: string | null;
  model?: string | null;
  answerVersion?: string | null;
  failureReason?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

interface ConversationView {
  id: string;
  title?: string | null;
  propositionId?: string | null;
  proposition?: { id: string; type: string; number: number; year: number } | null;
  lastInteractionAt: string;
  createdAt: string;
  messages: Message[];
}

interface ConversationListResponse {
  items: Array<{
    id: string;
    title?: string | null;
    propositionId?: string | null;
    proposition?: { id: string; type: string; number: number; year: number } | null;
    lastInteractionAt: string;
    createdAt: string;
    messageCount: number;
    lastMessage?: string | null;
  }>;
  activeConversationId: string | null;
}

async function openSource(source: Source, conversationId: string) {
  const { url } = await apiFetch<{ url: string }>(
    `/conversations/${conversationId}/sources/${source.documentId}/download`,
    { method: 'POST' },
  );
  window.open(`${url}#page=${source.pageNumber}`, '_blank', 'noopener,noreferrer');
}

export default function ConversationsPage() {
  const [list, setList] = useState<ConversationListResponse>({
    items: [],
    activeConversationId: null,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [draft, setDraft] = useState('');
  const [propositionId, setPropositionId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    const data = await apiFetch<ConversationListResponse>('/conversations');
    setList(data);
    if (data.activeConversationId) setActiveId(data.activeConversationId);
  }, []);

  useEffect(() => {
    refreshList().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Falha ao carregar conversas.'),
    );
  }, [refreshList]);

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id);
    const view = await apiFetch<ConversationView>(`/conversations/${id}`);
    setConversation(view);
    setError(null);
  }, []);

  // After creating a conversation refresh the list and open it.
  const createConversation = useCallback(async () => {
    setSending(true);
    try {
      const body: Record<string, string> = {};
      if (propositionId.trim()) body.propositionId = propositionId.trim();
      await apiFetch<ConversationView>('/conversations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPropositionId('');
      const data = await apiFetch<ConversationListResponse>('/conversations');
      setList(data);
      if (data.activeConversationId) await selectConversation(data.activeConversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar conversa.');
    } finally {
      setSending(false);
    }
  }, [propositionId, selectConversation]);

  const sendMessage = useCallback(async () => {
    const content = draft.trim();
    if (!content || !activeId) return;
    setSending(true);
    try {
      const view = await apiFetch<ConversationView>(`/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setConversation(view);
      setDraft('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }, [activeId, draft]);

  // Poll while any assistant message is still pending.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const view = await apiFetch<ConversationView>(`/conversations/${activeId}`);
        if (!cancelled) setConversation(view);
        const pending = view.messages.some((message) => message.status === 'PENDING');
        if (pending) timer = setTimeout(poll, 2_000);
      } catch {
        if (!cancelled) setError('Falha ao sincronizar a resposta.');
      }
    };
    timer = setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId, conversation?.messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages.length]);

  const selectedTitle =
    conversation?.title ?? list.items.find((item) => item.id === activeId)?.title ?? 'Conversa';

  return (
    <div className="mx-auto max-w-[1480px]">
      <div>
        <p className="text-sm font-semibold text-brand-600">Fiscaliza AI</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em] sm:text-4xl">Conversas</h1>
        <p className="mt-2 text-sm text-black/50">
          Pergunte sobre proposições e receba respostas com fontes verificáveis.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="card space-y-4 p-4">
          <div className="flex flex-col gap-2">
            <input
              value={propositionId}
              onChange={(event) => setPropositionId(event.target.value)}
              placeholder="ID da proposição (opcional)"
              className="input"
              aria-label="ID da proposição"
            />
            <button
              onClick={() => void createConversation()}
              disabled={sending}
              className="button-primary"
            >
              Nova conversa
            </button>
          </div>
          <nav className="space-y-1" aria-label="Conversas">
            {list.items.length === 0 ? (
              <p className="px-2 py-3 text-sm text-black/45">
                Nenhuma conversa ainda. Comece uma acima.
              </p>
            ) : (
              list.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void selectConversation(item.id)}
                  className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    item.id === activeId
                      ? 'bg-brand-50 font-medium text-brand-900'
                      : 'hover:bg-black/5'
                  }`}
                >
                  <span className="block truncate font-medium">{item.title ?? 'Conversa'}</span>
                  <span className="mt-0.5 block truncate text-xs text-black/45">
                    {item.lastMessage ?? `${item.messageCount} mensagens`}
                  </span>
                </button>
              ))
            )}
          </nav>
        </aside>

        <section className="card flex min-h-[480px] flex-col p-0">
          <header className="flex items-center justify-between border-b border-black/10 px-5 py-3">
            <div>
              <p className="font-semibold">{selectedTitle}</p>
              {conversation?.proposition ? (
                <p className="text-xs text-black/45">
                  Proposição {conversation.proposition.number}/{conversation.proposition.year} ·{' '}
                  {conversation.proposition.type}
                </p>
              ) : (
                <p className="text-xs text-black/45">Sem contexto de proposição</p>
              )}
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {conversation === null ? (
              <div className="grid min-h-72 place-items-center">
                <div className="max-w-sm text-center">
                  <p className="font-semibold">Escolha uma conversa</p>
                  <p className="mt-1 text-sm text-black/45">
                    Selecione uma conversa existente ou crie uma nova para começar.
                  </p>
                </div>
              </div>
            ) : conversation.messages.length === 0 ? (
              <div className="grid min-h-72 place-items-center">
                <p className="text-sm text-black/45">Nenhuma mensagem ainda.</p>
              </div>
            ) : (
              conversation.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  conversationId={conversation.id}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <footer className="border-t border-black/10 p-4">
            {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
            <div className="flex gap-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
                placeholder="Escreva sua pergunta…"
                className="input min-h-20 flex-1 resize-none"
                aria-label="Mensagem"
                disabled={activeId === null}
              />
              <button
                onClick={() => void sendMessage()}
                disabled={sending || activeId === null || !draft.trim()}
                className="button-primary self-end"
              >
                Enviar
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

function MessageBubble({ message, conversationId }: { message: Message; conversationId: string }) {
  const isUser = message.role === 'USER';
  const pending = message.status === 'PENDING';

  if (message.role === 'SYSTEM_EVENT') {
    return (
      <div className="text-center text-xs text-black/45">
        <p>{message.content}</p>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-brand-700 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-black/10 bg-white px-4 py-3">
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-black/50">
            <span
              className="size-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
              aria-hidden
            />
            Elaborando resposta…
          </p>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
            {message.sources.length > 0 ? (
              <div className="mt-3 border-t border-black/8 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-black/40">
                  Fontes
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {message.sources.map((source) => (
                    <button
                      key={source.documentPageId}
                      onClick={() => void openSource(source, conversationId)}
                      className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-800 hover:bg-brand-100"
                      title={source.excerpt ?? `Documento ${source.documentId.slice(0, 8)}`}
                    >
                      Documento · página {source.pageNumber}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {message.status === 'FAILED' ? (
              <p className="mt-2 text-xs text-red-700">
                {message.failureReason ?? 'Não foi possível responder.'}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
