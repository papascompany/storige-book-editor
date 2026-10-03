// @vitest-environment happy-dom
// 검증 결과 표시 — TRIMBOX_SIZE_BASIS 는 정보성 라벨·색과 재단 크기 상세 줄로, metadata.trimBox 는 메타데이터 행으로 보인다.
import { renderWithAntd } from '../test/renderWithAntd';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ValidationResultView } from './ValidationResultView';
import { extractValidationResult, type ValidationView } from './validationResultHelpers';

const trimBoxWarning = {
  code: 'TRIMBOX_SIZE_BASIS',
  message: '재단 크기(TrimBox) 기준으로 판형을 확인했습니다.',
  details: {
    sizeBasis: 'trimBox',
    trimBox: { width: 210, height: 297 },
    mediaBox: { width: 236, height: 323 },
  },
  autoFixable: false,
};

const bleedWarning = {
  code: 'BLEED_MISSING',
  message: '재단 여백이 없습니다.',
  autoFixable: true,
  fixMethod: 'extendBleed',
};

function view(raw: unknown, status = 'COMPLETED'): ValidationView {
  const result = extractValidationResult(raw, status);
  if (!result) throw new Error('검증 결과 픽스처 형식이 맞지 않습니다');
  return result;
}

const passingWithTrimBox = view({
  result: {
    isValid: true,
    errors: [],
    warnings: [trimBoxWarning, bleedWarning],
    metadata: {
      pageCount: 4,
      pageSize: { width: 236, height: 323 },
      hasBleed: true,
      bleedSize: 3,
      colorMode: 'CMYK',
      trimBox: { width: 210, height: 297 },
    },
  },
});

function tagOf(text: string): HTMLElement {
  const tag = screen.getByText(text).closest<HTMLElement>('.ant-tag');
  if (!tag) throw new Error(`'${text}' 태그가 없습니다`);
  return tag;
}

describe('ValidationResultView', () => {
  it('TRIMBOX_SIZE_BASIS 는 정보성 라벨·파란 태그로, 다른 경고는 기존 라벨·경고 태그로 보인다', () => {
    renderWithAntd(<ValidationResultView result={passingWithTrimBox} />);

    expect(tagOf('재단 크기(TrimBox) 기준 판형').classList.contains('ant-tag-blue')).toBe(true);
    expect(screen.queryByText('TRIMBOX_SIZE_BASIS')).toBeNull();
    expect(tagOf('재단 여백 없음').classList.contains('ant-tag-warning')).toBe(true);
    expect(screen.getByText('extendBleed')).toBeTruthy();
  });

  it('TRIMBOX_SIZE_BASIS 메시지 아래에 재단 크기와 원본 페이지 크기를 한 줄로 보인다', () => {
    renderWithAntd(<ValidationResultView result={passingWithTrimBox} />);

    expect(screen.getByText('재단 크기(TrimBox) 기준으로 판형을 확인했습니다.')).toBeTruthy();
    expect(
      screen.getByText('재단 크기 210.0 x 297.0 mm · 원본 페이지(MediaBox) 236.0 x 323.0 mm'),
    ).toBeTruthy();
  });

  it('metadata.trimBox 가 있으면 PDF 메타데이터에 재단 크기(TrimBox) 행을 보인다', () => {
    renderWithAntd(<ValidationResultView result={passingWithTrimBox} />);

    expect(screen.getByText('재단 크기(TrimBox)')).toBeTruthy();
    expect(screen.getByText('210.0 x 297.0 mm')).toBeTruthy();
    expect(screen.getByText('236.0 x 323.0 mm')).toBeTruthy();
    expect(screen.getByText('있음 (3mm)')).toBeTruthy();
    expect(screen.getByText('CMYK')).toBeTruthy();
  });

  it('metadata.trimBox 가 없으면 기존 메타데이터 4행만 보인다', () => {
    renderWithAntd(
      <ValidationResultView result={view({ isValid: true, errors: [], warnings: [], metadata: { pageCount: 2 } })} />,
    );

    expect(screen.queryByText('재단 크기(TrimBox)')).toBeNull();
    for (const label of ['페이지 수', '페이지 크기', '재단 여백', '색상 모드']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('정보성 경고가 있으면 요약에 정보 개수를 덧붙인다', () => {
    renderWithAntd(<ValidationResultView result={passingWithTrimBox} />);

    expect(screen.getByText('검증 통과')).toBeTruthy();
    expect(screen.getByText('에러: 0개, 경고: 2개 (정보 1개 포함)')).toBeTruthy();
  });

  it('정보성 경고가 없으면 요약은 에러·경고 개수만 보인다', () => {
    renderWithAntd(
      <ValidationResultView
        result={view({
          isValid: false,
          errors: [{ code: 'SIZE_MISMATCH', message: '판형이 다릅니다.', details: {}, autoFixable: false }],
          warnings: [{ code: 'NEW_CODE_X', message: '새 경고', autoFixable: false }],
          metadata: {},
        })}
      />,
    );

    expect(screen.getByText('검증 실패')).toBeTruthy();
    expect(screen.getByText('에러: 1개, 경고: 1개')).toBeTruthy();
    expect(tagOf('사이즈 불일치').classList.contains('ant-tag-error')).toBe(true);
    expect(tagOf('NEW_CODE_X').classList.contains('ant-tag-warning')).toBe(true);
  });

  it('형식이 맞지 않는 원소·필드가 섞인 결과도 예외 없이 렌더하고 맞는 값만 보인다', () => {
    const odd = view(
      {
        result: {
          isValid: false,
          errors: [null, { code: 1 }, { code: 'SIZE_MISMATCH', message: { text: 'x' }, fixMethod: {} }],
          warnings: [
            'TRIMBOX_SIZE_BASIS',
            { code: 'TRIMBOX_SIZE_BASIS', message: 7, details: { trimBox: { width: '210', height: 297 } } },
          ],
          metadata: {
            pageCount: { n: 4 },
            pageSize: { width: '210', height: 297 },
            colorMode: { name: 'CMYK' },
            trimBox: 'x',
          },
        },
      },
      'FAILED',
    );

    expect(() => renderWithAntd(<ValidationResultView result={odd} />)).not.toThrow();
    expect(screen.getByText('에러: 1개, 경고: 1개 (정보 1개 포함)')).toBeTruthy();
    expect(tagOf('사이즈 불일치')).toBeTruthy();
    expect(tagOf('재단 크기(TrimBox) 기준 판형')).toBeTruthy();
    expect(screen.queryByText(/^재단 크기 \d/)).toBeNull();
    expect(screen.queryByText('재단 크기(TrimBox)')).toBeNull();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(3);
  });
});
