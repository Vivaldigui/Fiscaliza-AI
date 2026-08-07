import { createHash } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaClient, RoleCode, UserStatus } from '@prisma/client';
import type { SettingValueType } from '@prisma/client';
import { initialSystemSettings } from '@fiscaliza/shared';

const prisma = new PrismaClient();

const roles: Array<{ code: RoleCode; name: string; description: string }> = [
  { code: RoleCode.ADMIN, name: 'Administrador', description: 'Configuração e gestão do sistema.' },
  {
    code: RoleCode.SECRETARIAT,
    name: 'Secretaria',
    description: 'Ingestão, cadastro, associação e revisão.',
  },
  {
    code: RoleCode.COUNCILOR,
    name: 'Vereador',
    description: 'Consulta suas próprias proposições por padrão.',
  },
  { code: RoleCode.AUDITOR, name: 'Auditor', description: 'Leitura e auditoria sem edição.' },
];

async function seedRoles(): Promise<void> {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }
}

async function seedSettings(): Promise<void> {
  for (const [key, definition] of Object.entries(initialSystemSettings)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { description: definition.description },
      create: {
        key,
        value: definition.value,
        valueType: definition.valueType as SettingValueType,
        description: definition.description,
      },
    });
  }
}

async function seedOptionalAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador inicial';

  if (!email && !password) {
    process.stdout.write(
      'Bootstrap admin ignorado: SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD não definidos.\n',
    );
    return;
  }

  if (!email || !password) {
    throw new Error('Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD juntos.');
  }

  if (password.length < 12 || password.startsWith('CHANGE_ME')) {
    throw new Error(
      'SEED_ADMIN_PASSWORD deve ter ao menos 12 caracteres e não pode ser placeholder.',
    );
  }

  const passwordHash = await hash(password, { type: 2 });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.ADMIN } });
  const user = await prisma.user.upsert({
    where: { email },
    update: { name },
    create: { email, name, passwordHash, status: UserStatus.ACTIVE },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  const fingerprint = createHash('sha256').update(user.id).digest('hex').slice(0, 12);
  process.stdout.write(`Administrador bootstrap garantido (referência ${fingerprint}).\n`);
}

async function main(): Promise<void> {
  await seedRoles();
  await seedSettings();
  await seedOptionalAdmin();
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Falha desconhecida no seed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
