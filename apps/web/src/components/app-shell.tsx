'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Icon } from './icons';

const navigation = [
  { href: '/dashboard', label: 'Visão geral', icon: 'dashboard' },
  { href: '/documentos', label: 'Documentos', icon: 'file' },
  { href: '/proposicoes', label: 'Proposições', icon: 'file' },
  { href: '/requerimentos', label: 'Requerimentos', icon: 'file' },
  { href: '/indicacoes', label: 'Indicações', icon: 'file' },
  { href: '/conversas', label: 'Conversas', icon: 'message' },
  { href: '/respostas', label: 'Respostas', icon: 'response' },
  { href: '/associacoes', label: 'Pendências de associação', icon: 'review' },
  { href: '/revisoes', label: 'Revisões da IA', icon: 'review' },
  { href: '/prazos', label: 'Prazos', icon: 'clock' },
  { href: '/feriados', label: 'Feriados', icon: 'clock' },
  { href: '/vereadores', label: 'Vereadores', icon: 'users' },
  { href: '/whatsapp', label: 'WhatsApp', icon: 'message' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings' },
  { href: '/auditoria', label: 'Auditoria', icon: 'audit' },
  { href: '/uso-ia', label: 'Uso da IA', icon: 'dashboard' },
];

interface UserIdentity {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserIdentity | null>(null);

  useEffect(() => {
    apiFetch<UserIdentity>('/auth/me')
      .then(setUser)
      .catch(() => router.replace('/login'));
  }, [router]);

  async function logout() {
    await apiFetch<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
      {open ? (
        <button
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col bg-brand-900 text-white transition-transform lg:sticky lg:top-0 lg:h-screen ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="grid size-10 place-items-center rounded-xl bg-white/10 font-bold">F</div>
          <div>
            <p className="font-semibold tracking-wide">FISCALIZA AI</p>
            <p className="text-xs text-white/45">Câmara Municipal</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Navegação principal">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-white/35">
            Operação
          </p>
          <ul className="space-y-1">
            {navigation.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition ${active ? 'bg-white text-brand-900 shadow-sm' : 'text-white/68 hover:bg-white/8 hover:text-white'}`}
                  >
                    <Icon name={item.icon} className="size-[18px]" />
                    <span>{item.label}</span>
                    {item.href === '/associacoes' ? (
                      <span className="ml-auto rounded-full bg-amber/20 px-2 py-0.5 text-xs text-amber-100">
                        0
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-500 text-sm font-semibold">
              {user?.name?.slice(0, 1).toUpperCase() ?? '…'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name ?? 'Carregando'}</p>
              <p className="truncate text-xs text-white/45">{user?.roles?.join(' · ') ?? ''}</p>
            </div>
            <button
              onClick={logout}
              className="rounded-lg px-2 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white"
            >
              Sair
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/5 bg-paper/90 px-4 backdrop-blur sm:px-7 lg:px-10">
          <button
            className="rounded-lg p-2 hover:bg-black/5 lg:hidden"
            aria-label="Abrir menu"
            onClick={() => setOpen(true)}
          >
            <span className="block h-0.5 w-5 bg-ink before:block before:h-0.5 before:w-5 before:-translate-y-1.5 before:bg-ink after:block after:h-0.5 after:w-5 after:translate-y-1 after:bg-ink" />
          </button>
          <div className="hidden items-center gap-2 text-xs text-black/45 sm:flex">
            <span className="size-2 rounded-full bg-emerald-500" /> Ambiente interno
          </div>
          <button className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm text-black/60 hover:border-black/20">
            Ajuda
          </button>
        </header>
        <main className="px-4 py-7 sm:px-7 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
