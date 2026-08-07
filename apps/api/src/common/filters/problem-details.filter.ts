import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ProblemDetails } from '@fiscaliza/shared';
import type { Request, Response } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail = extractDetail(raw, status);
    const code = extractCode(raw);
    const requestId = response.getHeader('x-request-id')?.toString();
    const problem: ProblemDetails = {
      type: `https://httpstatuses.com/${status}`,
      title: HttpStatus[status] ?? 'Erro',
      status,
      detail,
      instance: request.originalUrl,
      ...(requestId ? { requestId } : {}),
      ...(code ? { code } : {}),
    };
    response.status(status).type('application/problem+json').json(problem);
  }
}

function extractCode(raw: string | object | undefined): string | undefined {
  if (!raw || typeof raw === 'string' || !('code' in raw)) return undefined;
  const code = (raw as { code?: unknown }).code;
  return typeof code === 'string' && code.length <= 100 ? code : undefined;
}

function extractDetail(raw: string | object | undefined, status: number): string {
  if (status >= 500)
    return 'Ocorreu um erro interno. Use o identificador da requisição para suporte.';
  if (typeof raw === 'string') return raw;
  if (raw && 'message' in raw) {
    const message = (raw as { message: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return 'Não foi possível concluir a solicitação.';
}
