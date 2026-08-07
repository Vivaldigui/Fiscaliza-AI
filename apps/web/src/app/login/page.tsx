import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-white/10 text-lg font-bold">
            F
          </div>
          <span className="font-semibold tracking-wide">FISCALIZA AI</span>
        </div>
        <div className="max-w-xl pb-10">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[.24em] text-brand-100">
            Câmara Municipal
          </p>
          <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-.035em]">
            Documentos públicos exigem respostas verificáveis.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-white/70">
            Acompanhe solicitações, prazos e evidências com uma trilha completa de auditoria.
          </p>
        </div>
        <p className="text-sm text-white/45">Uso interno • Acesso controlado</p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-xl bg-brand-700 font-bold text-white">
              F
            </div>
            <span className="font-semibold">FISCALIZA AI</span>
          </div>
          <p className="text-sm font-semibold text-brand-600">Acesso seguro</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-.025em]">Entre na sua conta</h2>
          <p className="mt-3 text-sm leading-6 text-black/55">
            Use as credenciais fornecidas pela administração da Câmara.
          </p>
          <LoginForm />
          <p className="mt-7 text-xs leading-5 text-black/45">
            Ao acessar, suas ações ficam registradas para fins de segurança e auditoria.
          </p>
        </div>
      </section>
    </main>
  );
}
