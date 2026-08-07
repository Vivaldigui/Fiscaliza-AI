import { z } from 'zod';

export const countingModeSchema = z.enum(['CALENDAR_DAYS', 'BUSINESS_DAYS']);

const positiveDays = z.number().int().min(0).max(3650);
const confidence = z.number().min(0).max(1);

export const settingSchemas = {
  'deadlines.initialResponseDays': positiveDays,
  'deadlines.extensionDays': positiveDays,
  'deadlines.countingMode': countingModeSchema,
  'deadlines.timezone': z
    .string()
    .min(1)
    .max(100)
    .refine(
      (value) => {
        try {
          Intl.DateTimeFormat('pt-BR', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Timezone IANA inválido' },
    ),
  'deadlines.dueSoonDays': positiveDays,
  'deadlines.allowSuspension': z.boolean(),
  'analysis.confidence.normal': confidence,
  'analysis.confidence.warning': confidence,
  'association.autoThreshold': confidence,
  'association.minimumMargin': confidence,
  'documents.maxSizeMb': z.number().int().min(1).max(500),
} as const;

export type SystemSettingKey = keyof typeof settingSchemas;

export interface SettingDefinition {
  value: string | number | boolean;
  valueType: 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'JSON';
  description: string;
}

export const initialSystemSettings: Record<SystemSettingKey, SettingDefinition> = {
  'deadlines.initialResponseDays': {
    value: 15,
    valueType: 'INTEGER',
    description: 'Quantidade de dias do prazo inicial de resposta.',
  },
  'deadlines.extensionDays': {
    value: 15,
    valueType: 'INTEGER',
    description: 'Quantidade padrão de dias concedidos em uma prorrogação.',
  },
  'deadlines.countingMode': {
    value: 'CALENDAR_DAYS',
    valueType: 'STRING',
    description: 'Modo de contagem: dias corridos ou dias úteis.',
  },
  'deadlines.timezone': {
    value: 'America/Sao_Paulo',
    valueType: 'STRING',
    description: 'Timezone IANA usado nos cálculos administrativos.',
  },
  'deadlines.dueSoonDays': {
    value: 3,
    valueType: 'INTEGER',
    description: 'Antecedência, em dias, para classificar um prazo como próximo.',
  },
  'deadlines.allowSuspension': {
    value: true,
    valueType: 'BOOLEAN',
    description: 'Permite registrar eventos formais de suspensão de prazo.',
  },
  'analysis.confidence.normal': {
    value: 0.85,
    valueType: 'DECIMAL',
    description: 'Confiança mínima para apresentação sem aviso.',
  },
  'analysis.confidence.warning': {
    value: 0.6,
    valueType: 'DECIMAL',
    description: 'Confiança mínima para apresentação com aviso.',
  },
  'association.autoThreshold': {
    value: 0.9,
    valueType: 'DECIMAL',
    description: 'Pontuação mínima para associação automática.',
  },
  'association.minimumMargin': {
    value: 0.15,
    valueType: 'DECIMAL',
    description: 'Diferença mínima entre o primeiro e o segundo candidato.',
  },
  'documents.maxSizeMb': {
    value: 25,
    valueType: 'INTEGER',
    description: 'Tamanho máximo de PDF permitido no upload manual.',
  },
};

export function isSystemSettingKey(key: string): key is SystemSettingKey {
  return Object.hasOwn(settingSchemas, key);
}

export function parseSettingValue(key: SystemSettingKey, value: unknown): unknown {
  return settingSchemas[key].parse(value);
}
