import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import net from 'node:net';
import { DocumentProcessingError } from './errors';

export type SecurityScanStatus = 'CLEAN' | 'INFECTED' | 'SKIPPED';

export interface SecurityScanResult {
  status: SecurityScanStatus;
  scanner: string;
  signature?: string;
  detail: string;
}

export interface DocumentSecurityScanner {
  scan(filePath: string): Promise<SecurityScanResult>;
}

export class DisabledDocumentSecurityScanner implements DocumentSecurityScanner {
  async scan(): Promise<SecurityScanResult> {
    return {
      status: 'SKIPPED',
      scanner: 'disabled',
      detail: 'Antivírus desabilitado explicitamente por configuração.',
    };
  }
}

export interface ClamAvScannerConfig {
  host: string;
  port: number;
  timeoutMs: number;
  chunkSize?: number;
}

export class ClamAvDocumentSecurityScanner implements DocumentSecurityScanner {
  constructor(private readonly config: ClamAvScannerConfig) {}

  async scan(filePath: string): Promise<SecurityScanResult> {
    const socket = net.createConnection({ host: this.config.host, port: this.config.port });
    socket.setTimeout(this.config.timeoutMs);
    const response = this.readResponse(socket);
    try {
      await once(socket, 'connect');
      socket.write(Buffer.from('zINSTREAM\0'));
      const stream = createReadStream(filePath, {
        highWaterMark: this.config.chunkSize ?? 64 * 1024,
      });
      for await (const value of stream) {
        const chunk = value as Buffer;
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length);
        if (!socket.write(length)) await once(socket, 'drain');
        if (!socket.write(chunk)) await once(socket, 'drain');
      }
      socket.write(Buffer.alloc(4));
      const reply = await response;
      return parseClamAvResponse(reply);
    } catch (error) {
      socket.destroy();
      throw new DocumentProcessingError(
        'SECURITY_SCAN_FAILED',
        error instanceof Error ? error.message : 'O scanner antivírus falhou.',
        true,
      );
    } finally {
      socket.destroy();
    }
  }

  private readResponse(socket: net.Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const value = Buffer.concat(chunks);
        const terminator = value.indexOf(0);
        if (terminator >= 0) resolve(value.subarray(0, terminator).toString('utf8').trim());
      });
      socket.once('timeout', () => reject(new Error('Timeout ao consultar o ClamAV.')));
      socket.once('error', reject);
      socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    });
  }
}

export function parseClamAvResponse(reply: string): SecurityScanResult {
  if (/\bOK$/i.test(reply)) {
    return { status: 'CLEAN', scanner: 'clamav', detail: 'Nenhuma ameaça detectada.' };
  }
  const infected = /:\s*(.+)\s+FOUND$/i.exec(reply);
  if (infected?.[1]) {
    return {
      status: 'INFECTED',
      scanner: 'clamav',
      signature: infected[1],
      detail: 'Ameaça detectada; documento mantido em quarentena.',
    };
  }
  throw new DocumentProcessingError(
    'SECURITY_SCAN_FAILED',
    `Resposta inesperada do ClamAV: ${reply.slice(0, 200) || 'vazia'}`,
    true,
  );
}
