/**
 * 운영자 대리 편집 토큰 허용 핸들러 고정 (2026-09-29, ADDITIVE).
 *
 * JwtAuthGuard 는 운영자 토큰을 기본 거부하고, 핸들러에 @PartnerOperatorAllowed() 가 있을 때만 통과시킨다.
 * 이 spec 은 그 허용 목록을 정확히 18개로 고정한다 — 추가·제거는 이 목록과 함께 의도적으로 바꿔야 한다.
 *  1) 소스 정적 스캔: apps/api/src/**\/*.ts(spec 제외)에서 '@PartnerOperatorAllowed(' 가 붙은 핸들러 집합
 *  2) 리플렉션: 같은 집합에만 메타데이터가 있고, 변경 메서드(POST/PATCH/PUT/DELETE)는 명시 목록뿐
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PARTNER_OPERATOR_ALLOWED_KEY } from '../decorators/partner-operator-allowed.decorator';
import { EditSessionsController } from '../../edit-sessions/edit-sessions.controller';
import { FilesController } from '../../files/files.controller';
import { WorkerJobsController } from '../../worker-jobs/worker-jobs.controller';
import { EditorContentsController } from '../../editor-contents/editor-contents.controller';
import { AuthController } from '../auth.controller';

const SRC_ROOT = path.resolve(__dirname, '..', '..');

const EXPECTED: Record<string, string[]> = {
  'edit-sessions/edit-sessions.controller.ts': [
    'complete',
    'delete',
    'findOne',
    'getVersion',
    'listVersions',
    'restoreVersion',
    'update',
  ],
  'files/files.controller.ts': ['presignUpload', 'uploadFile'],
  'worker-jobs/worker-jobs.controller.ts': ['createValidationJob', 'findOne'],
  'editor-contents/editor-contents.controller.ts': [
    'findOne',
    'getBackgrounds',
    'getElements',
    'getFrames',
    'getImages',
    'getTemplates',
  ],
  'auth/auth.controller.ts': ['getMe'],
};

type Ctor = { prototype: object; name: string };

const CONTROLLERS: Array<[string, Ctor]> = [
  ['edit-sessions/edit-sessions.controller.ts', EditSessionsController],
  ['files/files.controller.ts', FilesController],
  ['worker-jobs/worker-jobs.controller.ts', WorkerJobsController],
  ['editor-contents/editor-contents.controller.ts', EditorContentsController],
  ['auth/auth.controller.ts', AuthController],
];

/** 변경 메서드가 허용된 핸들러(명시) — 그 외 허용 핸들러는 전부 GET 이어야 한다 */
const MUTATING_ALLOWED = new Set<string>([
  'edit-sessions/edit-sessions.controller.ts#update',
  'edit-sessions/edit-sessions.controller.ts#complete',
  'edit-sessions/edit-sessions.controller.ts#delete',
  'edit-sessions/edit-sessions.controller.ts#restoreVersion',
  'files/files.controller.ts#uploadFile',
  'files/files.controller.ts#presignUpload',
  'worker-jobs/worker-jobs.controller.ts#createValidationJob',
  'auth/auth.controller.ts#getMe',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * '@PartnerOperatorAllowed(' 로 시작하는 줄 다음에 오는 첫 클래스 멤버 메서드 선언 이름.
 * 멤버 들여쓰기(공백 2칸) + `이름(` / `async 이름(` 형태만 선언으로 인정한다
 * (여러 줄에 걸친 다른 데코레이터 인자·주석은 건너뛴다).
 */
const MEMBER_DECL = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/;

function scanDecoratedHandlers(source: string): string[] {
  const lines = source.split('\n');
  const names: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('@PartnerOperatorAllowed(')) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const m = MEMBER_DECL.exec(lines[j]);
      if (m) {
        names.push(m[1]);
        break;
      }
    }
  }
  return names;
}

function handlerNames(ctor: Ctor): string[] {
  return Object.getOwnPropertyNames(ctor.prototype).filter((n) => {
    if (n === 'constructor') return false;
    const d = Object.getOwnPropertyDescriptor(ctor.prototype, n);
    return typeof d?.value === 'function';
  });
}

describe('운영자 허용 핸들러 — 정적 소스 스캔', () => {
  const found: Record<string, string[]> = {};
  for (const file of walk(SRC_ROOT)) {
    const names = scanDecoratedHandlers(fs.readFileSync(file, 'utf8'));
    if (names.length > 0) {
      found[path.relative(SRC_ROOT, file).split(path.sep).join('/')] = names.sort();
    }
  }

  it('파일별 허용 핸들러 집합이 정확히 일치한다(다른 파일에는 없음)', () => {
    expect(found).toEqual(EXPECTED);
  });

  it('총 18개', () => {
    const total = Object.values(found).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(18);
  });
});

describe('운영자 허용 핸들러 — 리플렉션', () => {
  it.each(CONTROLLERS)('%s: 메타데이터가 허용 목록 핸들러에만 있다', (file, ctor) => {
    const proto = ctor.prototype as Record<string, unknown>;
    const withMeta = handlerNames(ctor)
      .filter((n) => Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, proto[n] as object) === true)
      .sort();
    expect(withMeta).toEqual(EXPECTED[file]);
  });

  it.each(CONTROLLERS)('%s: 클래스 수준 메타데이터는 없다', (_file, ctor) => {
    expect(Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, ctor)).toBeUndefined();
  });

  it('명시 목록 밖의 허용 핸들러는 전부 GET', () => {
    for (const [file, ctor] of CONTROLLERS) {
      const proto = ctor.prototype as Record<string, object>;
      for (const name of EXPECTED[file]) {
        const method = Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod;
        if (MUTATING_ALLOWED.has(`${file}#${name}`)) continue;
        expect({ handler: `${file}#${name}`, method }).toEqual({
          handler: `${file}#${name}`,
          method: RequestMethod.GET,
        });
      }
    }
  });

  it('변경 메서드 허용 핸들러의 경로·메서드 고정', () => {
    const route = (ctor: Ctor, name: string): [string, RequestMethod] => {
      const fn = (ctor.prototype as Record<string, object>)[name];
      return [Reflect.getMetadata(PATH_METADATA, fn) as string, Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod];
    };
    expect(route(EditSessionsController, 'update')).toEqual([':id', RequestMethod.PATCH]);
    expect(route(EditSessionsController, 'complete')).toEqual([':id/complete', RequestMethod.PATCH]);
    expect(route(EditSessionsController, 'delete')).toEqual([':id', RequestMethod.DELETE]);
    expect(route(EditSessionsController, 'restoreVersion')).toEqual([':id/versions/:vid/restore', RequestMethod.POST]);
    expect(route(FilesController, 'uploadFile')).toEqual(['upload', RequestMethod.POST]);
    expect(route(FilesController, 'presignUpload')).toEqual(['presigned-upload', RequestMethod.POST]);
    expect(route(WorkerJobsController, 'createValidationJob')).toEqual(['validate', RequestMethod.POST]);
    expect(route(AuthController, 'getMe')).toEqual(['me', RequestMethod.POST]);
  });

  it('명시적으로 허용하지 않는 핸들러(대표) — 목록·생성·흡수·복구·admin·PUT', () => {
    const denied: Array<[Ctor, string]> = [
      [EditSessionsController, 'create'],
      [EditSessionsController, 'findSessions'],
      [EditSessionsController, 'findMy'],
      [EditSessionsController, 'findDeleted'],
      [EditSessionsController, 'restore'],
      [EditSessionsController, 'migrateGuestToMember'],
      [AuthController, 'getMeForAdmin'],
      [AuthController, 'changePassword'],
      [EditorContentsController, 'update'],
    ];
    for (const [ctor, name] of denied) {
      const fn = (ctor.prototype as Record<string, object>)[name];
      expect(typeof fn).toBe('function');
      expect(Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, fn)).toBeUndefined();
    }
  });
});
