import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hasSession = Boolean(
    request.cookies.get('fiscaliza_access')?.value ||
      request.cookies.get('fiscaliza_refresh')?.value,
  );
  if (request.nextUrl.pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  if (request.nextUrl.pathname !== '/login' && !hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/documentos/:path*',
    '/requerimentos/:path*',
    '/indicacoes/:path*',
    '/respostas/:path*',
    '/associacoes/:path*',
    '/revisoes/:path*',
    '/prazos/:path*',
    '/vereadores/:path*',
    '/whatsapp/:path*',
    '/configuracoes/:path*',
    '/auditoria/:path*',
    '/uso-ia/:path*',
    '/login',
  ],
};
