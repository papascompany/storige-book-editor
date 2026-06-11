import { memo, useState, useEffect, useCallback } from 'react'
import { FolderOpen, X, Loader as CircleNotch, FileText, Clock, Trash2 as Trash, AlertCircle as WarningCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { editSessionsApi, type EditSessionResponse } from '@/api'

interface WorkspaceModalProps {
  isOpen: boolean
  onLoad: (session: EditSessionResponse) => void
  onClose: () => void
}

/**
 * 저장된 작업 불러오기 모달
 */
export const WorkspaceModal = memo(function WorkspaceModal({
  isOpen,
  onLoad,
  onClose,
}: WorkspaceModalProps) {
  const [sessions, setSessions] = useState<EditSessionResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  // 세션 목록 로드
  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await editSessionsApi.getMySessions()
      // 최신순으로 정렬 — complete 세션도 포함해 표시 (2026-06-11).
      // 고객 저장본(장바구니 담기)은 전부 status='complete' 라 기존
      // `s.status !== 'complete'` 필터가 최근 저장본을 전부 숨기던 버그 수정.
      // complete 세션도 재편집 시 update 가 status:'editing' 역전환을 허용하므로 표시해도 무해.
      const sortedSessions = [...response.sessions]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setSessions(sortedSessions)
    } catch (err) {
      console.error('Failed to load sessions:', err)
      setError('저장된 작업 목록을 불러오는데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 모달 열릴 때 세션 로드
  useEffect(() => {
    if (isOpen) {
      loadSessions()
      setSelectedId(null)
    }
  }, [isOpen, loadSessions])

  // 세션 삭제
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (!confirm('이 작업을 삭제하시겠습니까?')) {
      return
    }

    try {
      setIsDeleting(id)
      await editSessionsApi.delete(id)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (selectedId === id) {
        setSelectedId(null)
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
      alert('삭제에 실패했습니다.')
    } finally {
      setIsDeleting(null)
    }
  }

  // 불러오기
  const handleLoad = () => {
    const session = sessions.find(s => s.id === selectedId)
    if (session) {
      onLoad(session)
    }
  }

  // 날짜 포맷팅
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 상태 라벨
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft':
        return '초안'
      case 'editing':
        return '편집 중'
      case 'complete':
        return '완료'
      default:
        return status
    }
  }

  // 모드 라벨
  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'cover':
        return '표지'
      case 'content':
        return '내지'
      case 'both':
        return '표지+내지'
      case 'template':
        return '템플릿'
      default:
        return mode
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              저장된 작업 불러오기
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <CircleNotch className="w-8 h-8 animate-spin text-blue-500 mb-4" />
              <p className="text-gray-500">작업 목록을 불러오는 중...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <WarningCircle className="w-12 h-12 text-red-400 mb-4" />
              <p className="text-red-600 mb-4">{error}</p>
              <button
                onClick={loadSessions}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                다시 시도
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="w-12 h-12 text-gray-300 mb-4" />
              <p className="text-gray-500">저장된 작업이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => setSelectedId(session.id)}
                  className={cn(
                    'p-4 border rounded-lg cursor-pointer transition-all',
                    selectedId === session.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">
                          주문 #{session.orderSeqno}
                        </span>
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded-full',
                          session.status === 'editing'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600'
                        )}>
                          {getStatusLabel(session.status)}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {getModeLabel(session.mode)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDate(session.updatedAt)}
                        </span>
                        {session.templateSetId && (
                          <span className="text-xs text-gray-400">
                            템플릿: {session.templateSetId.substring(0, 8)}...
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(session.id, e)}
                      disabled={isDeleting === session.id}
                      className={cn(
                        'p-2 rounded-lg transition-colors',
                        'text-gray-400 hover:text-red-500 hover:bg-red-50',
                        isDeleting === session.id && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {isDeleting === session.id ? (
                        <CircleNotch className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleLoad}
            disabled={!selectedId || isLoading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
              selectedId && !isLoading
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            )}
          >
            <FolderOpen className="w-4 h-4" />
            불러오기
          </button>
        </div>
      </div>
    </div>
  )
})
