import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@fiscaliza/database';
import { isSystemSettingKey, parseSettingValue, type SystemSettingKey } from '@fiscaliza/shared';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  async update(keyInput: string, value: unknown, version: number, actorId: string) {
    if (!isSystemSettingKey(keyInput)) throw new NotFoundException('Configuração desconhecida.');
    const key: SystemSettingKey = keyInput;
    const parsedValue = parseSettingValue(key, value);
    const current = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!current) throw new NotFoundException('Configuração não encontrada.');

    await this.validateCrossSettingRules(key, parsedValue);

    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.systemSetting.updateMany({
        where: { id: current.id, version },
        data: {
          value: parsedValue as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'A configuração foi alterada por outro usuário. Recarregue a tela.',
        );
      }
      const updated = await transaction.systemSetting.findUniqueOrThrow({
        where: { id: current.id },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'SYSTEM_SETTING_UPDATED',
          resourceType: 'SystemSetting',
          resourceId: current.id,
          previousState: { key, value: current.value, version: current.version },
          newState: { key, value: updated.value, version: updated.version },
        },
      });
      return updated;
    });
  }

  private async validateCrossSettingRules(key: SystemSettingKey, value: unknown): Promise<void> {
    if (!key.startsWith('analysis.confidence.')) return;
    const otherKey =
      key === 'analysis.confidence.normal'
        ? 'analysis.confidence.warning'
        : 'analysis.confidence.normal';
    const other = await this.prisma.systemSetting.findUnique({ where: { key: otherKey } });
    if (!other || typeof other.value !== 'number' || typeof value !== 'number') return;
    const normal = key === 'analysis.confidence.normal' ? value : other.value;
    const warning = key === 'analysis.confidence.warning' ? value : other.value;
    if (warning > normal) {
      throw new ConflictException('O limiar de aviso não pode ser maior que o limiar normal.');
    }
  }
}
