/**
 * e2e 용 인증 주체.
 *
 * 운영에서는 전역 JwtAuthGuard 가 req.user 를 채운 뒤 RolesGuard·TenantGuard·@CurrentScope 가 그 값을 읽는다.
 * JWT 를 띄우지 않는 spec 은 이 미들웨어로 전역 관리자를 req.user 에 둔다.
 * - TenantGuard: ADMIN 은 dual-mode 로 모든 site 통과(가드를 끄지 않는다).
 * - @CurrentScope: ADMIN 은 isGlobal=true(필터 없음).
 */
import type { NextFunction, Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { UserRole } from '@storige/types';
import { User } from '../../src/auth/entities/user.entity';

export const E2E_GLOBAL_ADMIN = {
  id: 'e2e-admin-id',
  email: 'e2e-admin@example.com',
  role: UserRole.ADMIN,
} as const;

export function asGlobalAdmin(
  req: Request & { user?: unknown },
  _res: Response,
  next: NextFunction,
): void {
  req.user = { ...E2E_GLOBAL_ADMIN };
  next();
}

/**
 * 주체의 users 행. 템플릿 생성·복사는 created_by(FK → users.id)에 주체 id 를 쓴다.
 * 운영의 관리자 계정이 users 에 있는 것과 같은 전제를 맞춘다(비밀번호는 쓰지 않는 자리값).
 */
export async function seedGlobalAdminRow(dataSource: DataSource): Promise<void> {
  await dataSource.getRepository(User).save({
    id: E2E_GLOBAL_ADMIN.id,
    email: E2E_GLOBAL_ADMIN.email,
    passwordHash: 'unused-in-e2e',
    role: E2E_GLOBAL_ADMIN.role,
  });
}
