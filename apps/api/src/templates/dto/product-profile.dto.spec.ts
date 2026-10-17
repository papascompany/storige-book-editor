/**
 * productProfile 은 forbidNonWhitelisted 전역 파이프를 통과해야 한다(P1 캘린더, 2026-10-17).
 * 중첩 객체가 DTO 미등록이면 admin 저장이 400 이 된다. 교차 필드 규칙은 types
 * `validateProductProfile` 의 문구가 그대로 400 메시지에 실려야 한다.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateTemplateSetDto, UpdateTemplateSetDto } from './template-set.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const base = { name: '탁상형 라지달력', type: 'leaflet', width: 265, height: 190 };

/** 오너 확정 탁상 라지 프리셋(admin calendarProfilePresets 와 동일 shape) */
const deskLargeProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: {
    faces: 2,
    canvasLayout: 'canvas-pair',
    binding: 'top-ring',
    pairing: 'offset-next',
    backRotation: 0,
    duplexFlip: 'short-edge',
  },
  calendar: {
    layout: 'desk',
    monthCount: 12,
    coverCanvases: 1,
    canvasesPerMonth: 2,
    epilogueCanvases: 1,
    allowedRange: { from: '2026-01', to: '2027-12' },
    weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true },
    dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
};

async function expect400(body: unknown, metatype: typeof CreateTemplateSetDto | typeof UpdateTemplateSetDto = CreateTemplateSetDto): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const res = (e as BadRequestException).getResponse() as { message: string[] | string };
    return Array.isArray(res.message) ? res.message : [res.message];
  }
  throw new Error('400 이어야 합니다');
}

describe('ProductProfileDto (P1 캘린더 프로파일 파이프)', () => {
  it('productProfile 생략 → 통과하고 undefined (기존 페이로드 비파괴)', async () => {
    const out = await pipe.transform({ ...base }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(out.productProfile).toBeUndefined();
  });

  it('productProfile: null → 통과 (명시적 미사용)', async () => {
    const out = await pipe.transform({ ...base, productProfile: null }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(out.productProfile).toBeNull();
  });

  it('탁상 라지 프리셋 JSON → Create 통과, 중첩 값 보존', async () => {
    const out = await pipe.transform(
      { ...base, productProfile: deskLargeProfile },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(JSON.parse(JSON.stringify(out.productProfile))).toEqual(deskLargeProfile);
  });

  it('탁상 라지 프리셋 JSON → Update 통과', async () => {
    const out = await pipe.transform(
      { productProfile: deskLargeProfile },
      { type: 'body', metatype: UpdateTemplateSetDto },
    );
    expect(out.productProfile?.calendar?.allowedRange).toEqual({ from: '2026-01', to: '2027-12' });
  });

  it('faceLabels 2개 문자열 → 통과', async () => {
    const out = await pipe.transform(
      {
        ...base,
        productProfile: {
          ...deskLargeProfile,
          calendar: { ...deskLargeProfile.calendar, layout: 'wall-2', faceLabels: ['상단', '하단'] },
        },
      },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(out.productProfile?.calendar?.faceLabels).toEqual(['상단', '하단']);
  });

  it('미등재 키(pages.foo) → 400 (forbidNonWhitelisted)', async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, pages: { ...deskLargeProfile.pages, foo: 1 } },
    });
    expect(messages.join('\n')).toContain('foo');
  });

  it('pages.count=25 (정합 위반) → 400 메시지에 types 오류 문구 포함', async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, pages: { ...deskLargeProfile.pages, count: 25 } },
    });
    const joined = messages.join('\n');
    expect(joined).toContain('pages.count(25)는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = 26 여야 합니다');
    expect(joined).toContain('sheet.faces=2 이면 pages.count 는 짝수여야 합니다');
  });

  it("kind:'photo-print' (P1 미지원) → 400", async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, kind: 'photo-print' },
    });
    expect(messages.join('\n')).toContain('kind');
  });

  it('faceLabels 1개 → 400', async () => {
    const messages = await expect400({
      ...base,
      productProfile: {
        ...deskLargeProfile,
        calendar: { ...deskLargeProfile.calendar, faceLabels: ['앞면'] },
      },
    });
    expect(messages.join('\n')).toContain('faceLabels');
  });
});
