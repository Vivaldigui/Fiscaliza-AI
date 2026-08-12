import { z } from 'zod';

export const countingModeSchema = z.enum(['CALENDAR_DAYS', 'BUSINESS_DAYS']);

const positiveDays = z.number().int().min(0).max(3650);
const confidence = z.number().min(0).max(1);

export const deadlinePolicySchema = z
  .object({
    policyVersion: z.number().int().positive(),
    initialResponseDays: positiveDays,
    extensionDays: positiveDays,
    countingMode: countingModeSchema,
    timezone: z.string().min(1).max(100),
    dueSoonDays: positiveDays,
    suspensionEnabled: z.boolean(),
    startDayRule: z.enum(['EXCLUDE_START_DATE', 'INCLUDE_START_DATE']),
    nonBusinessDueDateRule: z.enum(['NEXT_BUSINESS_DAY', 'PREVIOUS_BUSINESS_DAY', 'KEEP_DATE']),
    holidayScopes: z.array(z.enum(['NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL'])),
  })
  .strict();

export type DeadlinePolicy = z.infer<typeof deadlinePolicySchema>;

export const associationWeightsSchema = z
  .object({
    explicitReference: confidence,
    number: confidence,
    year: confidence,
    type: confidence,
    protocol: confidence,
    subject: confidence,
    temporal: confidence,
  })
  .strict()
  .refine(
    (value) => Math.abs(Object.values(value).reduce((sum, weight) => sum + weight, 0) - 1) < 0.001,
    { message: 'Os pesos de associação devem somar 1.' },
  );

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
  'deadlines.policy.REQUEST': deadlinePolicySchema,
  'deadlines.policy.INDICATION': deadlinePolicySchema,
  'analysis.confidence.normal': confidence,
  'analysis.confidence.warning': confidence,
  'association.autoThreshold': confidence,
  'association.minimumMargin': confidence,
  'association.signalWeights': associationWeightsSchema,
  'documents.maxSizeMb': z.number().int().min(1).max(500),
  'whatsapp.neutralReply': z.string().min(1).max(1_000),
} as const;

export type SystemSettingKey = keyof typeof settingSchemas;

export interface SettingDefinition {
  value: string | number | boolean | Record<string, unknown>;
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
  'deadlines.policy.REQUEST': {
    value: {
      policyVersion: 1,
      initialResponseDays: 15,
      extensionDays: 15,
      countingMode: 'CALENDAR_DAYS',
      timezone: 'America/Sao_Paulo',
      dueSoonDays: 3,
      suspensionEnabled: true,
      startDayRule: 'EXCLUDE_START_DATE',
      nonBusinessDueDateRule: 'NEXT_BUSINESS_DAY',
      holidayScopes: ['NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL'],
    },
    valueType: 'JSON',
    description: 'Política versionada de prazo aplicável a requerimentos.',
  },
  'deadlines.policy.INDICATION': {
    value: {
      policyVersion: 1,
      initialResponseDays: 15,
      extensionDays: 15,
      countingMode: 'CALENDAR_DAYS',
      timezone: 'America/Sao_Paulo',
      dueSoonDays: 3,
      suspensionEnabled: true,
      startDayRule: 'EXCLUDE_START_DATE',
      nonBusinessDueDateRule: 'NEXT_BUSINESS_DAY',
      holidayScopes: ['NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL'],
    },
    valueType: 'JSON',
    description: 'Política versionada de prazo aplicável a indicações.',
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
  'association.signalWeights': {
    value: {
      explicitReference: 0.5,
      number: 0.15,
      year: 0.1,
      type: 0.1,
      protocol: 0.05,
      subject: 0.05,
      temporal: 0.05,
    },
    valueType: 'JSON',
    description: 'Pesos normalizados dos sinais determinísticos de associação.',
  },
  'documents.maxSizeMb': {
    value: 25,
    valueType: 'INTEGER',
    description: 'Tamanho máximo de PDF permitido no upload manual.',
  },
  'whatsapp.neutralReply': {
    value:
      'Este número não está habilitado para consultas no Fiscaliza AI. Entre em contato com a administração da Câmara para solicitar acesso.',
    valueType: 'STRING',
    description: 'Resposta padrão para números sem identidade autorizada.',
  },
};

export function isSystemSettingKey(key: string): key is SystemSettingKey {
  return Object.hasOwn(settingSchemas, key);
}

export function parseSettingValue(key: SystemSettingKey, value: unknown): unknown {
  return settingSchemas[key].parse(value);
}
