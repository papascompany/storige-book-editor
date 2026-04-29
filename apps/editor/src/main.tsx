import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Production에서는 /storige-editor 경로에서 배포됨
const basename = import.meta.env.VITE_ROUTER_BASE || ''

// lucide-react는 IconContext.Provider 미지원 — 각 아이콘이 자체 props로 size/strokeWidth 지정
// 기본 lucide 아이콘 size=24 (phosphor와 동일)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
