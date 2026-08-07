import { notFound } from 'next/navigation';

const sections: Record<string, { title: string; description: string; action?: string }> = {
  requerimentos: {
    title: 'Requerimentos',
    description: 'Solicitações de informação ao Poder Executivo.',
    action: 'Novo requerimento',
  },
  indicacoes: {
    title: 'Indicações',
    description: 'Providências e ações sugeridas ao Poder Executivo.',
    action: 'Nova indicação',
  },
  respostas: {
    title: 'Respostas',
    description: 'Respostas recebidas e seu estado de processamento.',
  },
  associacoes: {
    title: 'Pendências de associação',
    description: 'Documentos ambíguos aguardando decisão da Secretaria.',
  },
  revisoes: {
    title: 'Revisões da IA',
    description: 'Análises de baixa confiança ou corrigidas por pessoas autorizadas.',
  },
  prazos: { title: 'Prazos', description: 'Vencimentos, prorrogações, suspensões e histórico.' },
  vereadores: {
    title: 'Vereadores',
    description: 'Perfis, mandatos, usuários e identidades de WhatsApp.',
    action: 'Novo vereador',
  },
  whatsapp: {
    title: 'WhatsApp',
    description: 'Identidades, conversas, filas e estado das integrações.',
  },
  configuracoes: {
    title: 'Configurações',
    description: 'Prazos, confiança, calendário e parâmetros do sistema.',
  },
  auditoria: { title: 'Auditoria', description: 'Histórico imutável de ações relevantes.' },
  'uso-ia': {
    title: 'Uso da IA',
    description: 'Latência, tokens, custo estimado e versões utilizadas.',
  },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const content = sections[section];
  if (!content) notFound();
  return (
    <div className="mx-auto max-w-[1480px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-600">Fiscaliza AI</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.03em] sm:text-4xl">
            {content.title}
          </h1>
          <p className="mt-2 text-sm text-black/50">{content.description}</p>
        </div>
        {content.action ? <button className="button-primary">{content.action}</button> : null}
      </div>
      <section className="card mt-8 grid min-h-72 place-items-center p-8 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-50 text-xl text-brand-700">
            ⌁
          </div>
          <h2 className="mt-4 font-semibold">Nenhum registro para mostrar</h2>
          <p className="mt-2 text-sm leading-6 text-black/45">
            A estrutura desta área está pronta. Os fluxos de domínio serão ativados na fase
            correspondente do plano de implementação.
          </p>
        </div>
      </section>
    </div>
  );
}
