import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'

/**
 * BrowseContentsView - Content browser for templates and designs
 * This is a placeholder view.
 */
export default function BrowseContentsView() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [contents] = useState<Array<{ id: string; title: string }>>([])

  const { initializeFromStorage } = useAuthStore()
  const token = searchParams.get('token')

  useEffect(() => {
    initializeFromStorage()

    if (token) {
      useAuthStore.getState().setToken(token)
    }
  }, [token, initializeFromStorage])

  const handleSelectContent = (contentId: string) => {
    navigate(`/?contentId=${contentId}`)
  }

  return (
    <div className="min-h-screen bg-editor-bg p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-editor-text">Browse Contents</h1>
        <p className="text-editor-text-muted mt-2">
          Select a template or design to edit
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {contents.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-editor-text-muted">
              No contents available. This view will be populated with templates and designs.
            </p>
          </div>
        ) : (
          contents.map((content) => (
            <div
              key={content.id}
              onClick={() => handleSelectContent(content.id)}
              className="bg-editor-panel border border-editor-border rounded-lg p-4 cursor-pointer hover:border-editor-accent transition-colors"
            >
              <div className="aspect-video bg-editor-bg rounded mb-3" />
              <h3 className="text-editor-text font-medium">{content.title}</h3>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
