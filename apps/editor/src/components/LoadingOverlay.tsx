import { Loader as CircleNotch } from 'lucide-react'

interface LoadingOverlayProps {
  visible: boolean
  message?: string
}

export default function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  if (!visible) return null

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-[9999]"
      style={{ backgroundColor: 'rgba(10, 10, 10, 0.55)' }}
    >
      <div className="relative" style={{ width: '80px', height: '80px' }}>
        {/* Track */}
        <svg className="absolute w-full h-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="8"
            fill="none"
          />
        </svg>
        {/* Spinner */}
        <div className="absolute inset-0 flex items-center justify-center">
          <CircleNotch className="w-16 h-16 text-white animate-spin" strokeWidth={2} />
        </div>
      </div>
      {message && (
        <p className="mt-6 text-base text-white/80 font-semibold tracking-wider">
          {message}
        </p>
      )}
    </div>
  )
}
