import { cn } from '@/lib/utils'

interface LibraryTagChipsProps {
  /** 디스커버된 태그 목록 (정렬됨). 비어있으면 아무것도 렌더하지 않음. */
  tags: string[]
  /** 현재 선택된 태그. null = "전체". */
  selectedTag: string | null
  /** 태그 선택 핸들러. null 전달 = "전체" 선택. */
  onSelect: (tag: string | null) => void
  /** "전체" 칩 라벨 (기본 "전체"). */
  allLabel?: string
}

/**
 * 에셋 패널 공통 태그 필터 칩 (요소/프레임/배경 일관 적용 — P3-b).
 *
 * 미리캔버스/캔바 정합 패턴: 추천 콘텐츠 섹션 상단에 "전체 / 태그1 / 태그2 …" 가로 스크롤 칩.
 * 모바일 임베드 좁은 폭 대응: `overflow-x-auto` + `flex-shrink-0` 으로 가로 스크롤,
 * 스크롤바는 숨김(scrollbarWidth:none). `-mx-4 px-4` 로 섹션 패딩을 가장자리까지 흘려보냄.
 *
 * AppElement(정본)에 인라인되어 있던 칩 마크업을 그대로 승격해 컴포넌트화한 것.
 * 시각/동작 회귀가 없도록 클래스/구조를 1:1 보존한다.
 */
export default function LibraryTagChips({
  tags,
  selectedTag,
  onSelect,
  allLabel = '전체',
}: LibraryTagChipsProps) {
  if (tags.length === 0) return null

  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-3 -mx-4 px-4"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <button
        className={cn(
          'whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors flex-shrink-0',
          !selectedTag
            ? 'bg-editor-accent border-editor-accent text-white'
            : 'border-editor-border text-editor-text-muted hover:text-editor-text hover:border-editor-text-muted'
        )}
        onClick={() => onSelect(null)}
      >
        {allLabel}
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          className={cn(
            'whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors flex-shrink-0',
            selectedTag === tag
              ? 'bg-editor-accent border-editor-accent text-white'
              : 'border-editor-border text-editor-text-muted hover:text-editor-text hover:border-editor-text-muted'
          )}
          onClick={() => onSelect(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  )
}
