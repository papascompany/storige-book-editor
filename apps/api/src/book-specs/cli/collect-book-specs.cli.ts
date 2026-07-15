/**
 * book_specs 판형 마스터 후보 수집 스크립트 (Partner API v1 Stage 1-B).
 *
 * ⚠️⚠️ DRY-RUN 전용 — DB 에 어떤 쓰기도 하지 않는다. ⚠️⚠️
 * 기존 데이터(template_sets 자유입력 width/height + productSpecs,
 * paper_types·binding_types 계수)를 읽어 book_specs 후보 행을 정규화 추출하고
 * JSON + INSERT SQL 을 stdout 으로만 출력한다.
 * 실제 시드는 오너가 산출물을 검토·승인한 후 수동 실행한다
 * (설계서 PARTNER_PLATFORM_API_V1_DESIGN §9-6, 로드맵 §8-9 —
 *  자유입력 데이터라 자동 승인 불가).
 *
 * 실행 (apps/api 에서, DB 접속 가능한 환경):
 *   pnpm collect:book-specs            # 사람이 읽는 리포트 + SQL
 *   pnpm collect:book-specs -- --json  # JSON 만 (기계 소비용)
 *
 * 정규화 규칙 정본: ./collect-book-specs.core.ts (순수 함수 — spec 검증 대상).
 */
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import {
  BindingTypeRow,
  PaperTypeRow,
  TemplateSetRow,
  collectBookSpecCandidates,
  toInsertSql,
} from './collect-book-specs.core';

async function main(): Promise<void> {
  const jsonOnly = process.argv.includes('--json');

  // 읽기 전용 컨텍스트 (HTTP 서버 미기동). AppModule 부팅 시 기존 시드
  // 서비스(OnModuleInit)들이 기존 규약대로 동작하지만 book_specs 에는 쓰지 않는다.
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
    logger: jsonOnly ? false : ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);

    const templateSets: TemplateSetRow[] = await dataSource.query(
      `SELECT id, name, type, width, height, bleed_mm, size_tolerance_mm,
              page_count_range, cover_type, product_specs, site_id, is_active
         FROM template_sets
        WHERE is_deleted = 0
        ORDER BY created_at ASC`,
    );
    const bindingTypes: BindingTypeRow[] = await dataSource.query(
      `SELECT code, min_pages, max_pages, page_multiple FROM binding_types WHERE is_active = 1`,
    );
    const paperTypes: PaperTypeRow[] = await dataSource.query(
      `SELECT code, category, is_active, sort_order FROM paper_types WHERE is_active = 1
        ORDER BY sort_order ASC`,
    );

    const { candidates, anomalies, excluded } = collectBookSpecCandidates(
      templateSets,
      bindingTypes,
      paperTypes,
    );

    const output = {
      generatedAt: new Date().toISOString(),
      dryRun: true as const,
      totals: {
        templateSetsScanned: templateSets.length,
        candidates: candidates.length,
        excluded,
        anomalies: anomalies.length,
      },
      candidates,
      anomalies,
    };

    if (jsonOnly) {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return;
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log(' book_specs 수집 DRY-RUN (DB 쓰기 없음 — 오너 검토·승인 후 수동 시드)');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(
      ` template_sets ${templateSets.length}건 스캔 → 후보 ${candidates.length}건 / 제외 ${excluded}건 / 이상치 ${anomalies.length}건`,
    );
    console.log('');
    for (const c of candidates) {
      console.log(
        ` • [${c.uid}] ${c.name} — ${c.innerTrimWidthMm}×${c.innerTrimHeightMm}mm ` +
          `${c.orientation} / ${c.coverType} / ${c.bindingType} / p${c.pageMin}~${c.pageMax}(+${c.pageIncrement})` +
          (c.reviewFlags.length ? ` ⚠ ${c.reviewFlags.join(',')}` : ''),
      );
    }
    if (anomalies.length > 0) {
      console.log('\n── 이상치 ──');
      for (const a of anomalies) {
        console.log(` ⚠ [${a.code}] ${a.name} (${a.templateSetId}): ${a.detail}`);
      }
    }
    console.log('\n── 시드 SQL 초안 (오너 승인 전 실행 금지) ──\n');
    for (const c of candidates) {
      console.log(toInsertSql(c) + '\n');
    }
    console.log('── JSON 전체는 `pnpm collect:book-specs -- --json` ──');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[collect-book-specs] 실패:', err);
  process.exitCode = 1;
});
