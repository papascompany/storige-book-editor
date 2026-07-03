// PDF 캡처 수신 서버 — 픽스처 페이지가 POST 한 PDF 바이트를 파일로 저장.
import http from 'node:http'
import { mkdirSync, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out')

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.writeHead(204).end()

  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'POST' && url.pathname === '/save') {
    const label = (url.searchParams.get('label') || 'unlabeled').replace(/[^a-zA-Z0-9_-]/g, '')
    const name = (url.searchParams.get('name') || 'out').replace(/[^a-zA-Z0-9_-]/g, '')
    const dir = join(OUT, label)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${name}.pdf`)
    const ws = createWriteStream(file)
    req.pipe(ws)
    ws.on('finish', () => {
      console.log(`[receiver] saved ${file}`)
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('OK')
    })
    ws.on('error', (e) => res.writeHead(500).end(String(e)))
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(3199, () => console.log('[receiver] listening :3199 →', OUT))
