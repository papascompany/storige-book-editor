import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Select, Space } from 'antd';
import { formatPresetsApi } from '../api/formatPresets';
import type { FormatPreset } from '../api/formatPresets';
import { formatSizeLabel, isSquare, orientTrim } from './formatPresetHelpers';
import type { PresetOrientation } from './formatPresetHelpers';

/** '직접 입력(비규격)' sentinel — 프리셋 아님, 주입 없음. */
const CUSTOM_VALUE = '__custom__';

/** 방향(가로형 W↔H 스왑) 적용이 끝난 재단 치수 + 도련 — 값 복사 주입용 페이로드. */
export interface FormatPresetApplyPayload {
  trimW: number;
  trimH: number;
  bleedMm: number;
}

interface FormatPresetSelectProps {
  /**
   * 프리셋/방향 선택 시 호출 — 방향 적용된 재단 치수 + 도련.
   * 소비측이 폼에 값 복사 주입한다(presetId 저장 금지 — 무스키마 원칙).
   */
  onApply: (payload: FormatPresetApplyPayload) => void;
  /** '직접 입력(비규격)' 선택 시 — 주입 없음(폼 값 유지). 보관 중인 프리셋 상태 해제용. */
  onCustom?: () => void;
}

/**
 * 판형 프리셋 공유 픽커 — 활성 프리셋 Select + 방향(세로/가로) Radio.
 *
 * - 정사각(W==H) 프리셋은 가로형 disabled(스왑 무의미).
 * - 기본 선택은 '직접 입력(비규격)' — 프리셋을 고르기 전에는 아무 값도 주입하지 않는다.
 */
export const FormatPresetSelect = ({ onApply, onCustom }: FormatPresetSelectProps) => {
  const [selectedId, setSelectedId] = useState<string>(CUSTOM_VALUE);
  const [orientation, setOrientation] = useState<PresetOrientation>('portrait');

  const { data: presets, isLoading } = useQuery({
    queryKey: ['format-presets'],
    queryFn: formatPresetsApi.list,
  });

  const activePresets = useMemo(
    () =>
      (presets ?? [])
        .filter((p) => p.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
    [presets],
  );

  const selectedPreset = activePresets.find((p) => p.id === selectedId);
  const squareSelected =
    !!selectedPreset && isSquare(selectedPreset.trimWidthMm, selectedPreset.trimHeightMm);

  const emitApply = (preset: FormatPreset, nextOrientation: PresetOrientation) => {
    const oriented = orientTrim(preset.trimWidthMm, preset.trimHeightMm, nextOrientation);
    onApply({
      trimW: oriented.widthMm,
      trimH: oriented.heightMm,
      bleedMm: preset.bleedMm,
    });
  };

  const handlePresetChange = (value: string) => {
    setSelectedId(value);
    if (value === CUSTOM_VALUE) {
      onCustom?.();
      return;
    }
    const preset = activePresets.find((p) => p.id === value);
    if (!preset) return;
    let nextOrientation = orientation;
    if (isSquare(preset.trimWidthMm, preset.trimHeightMm) && orientation === 'landscape') {
      // 정사각은 방향 개념이 없다 — 세로형으로 강제 복귀.
      nextOrientation = 'portrait';
      setOrientation('portrait');
    }
    emitApply(preset, nextOrientation);
  };

  const handleOrientationChange = (value: PresetOrientation) => {
    setOrientation(value);
    if (selectedPreset) {
      emitApply(selectedPreset, value);
    }
  };

  return (
    <Space wrap size="middle">
      <Select
        value={selectedId}
        onChange={handlePresetChange}
        loading={isLoading}
        style={{ minWidth: 240 }}
        options={[
          { value: CUSTOM_VALUE, label: '직접 입력 (비규격)' },
          ...activePresets.map((p) => ({
            value: p.id,
            label: `${p.name} — ${formatSizeLabel(p.trimWidthMm, p.trimHeightMm)}`,
          })),
        ]}
      />
      <Radio.Group
        value={orientation}
        onChange={(e) => handleOrientationChange(e.target.value as PresetOrientation)}
      >
        <Radio.Button value="portrait">세로형</Radio.Button>
        <Radio.Button value="landscape" disabled={squareSelected}>
          가로형
        </Radio.Button>
      </Radio.Group>
    </Space>
  );
};
