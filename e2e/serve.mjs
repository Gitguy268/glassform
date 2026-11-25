// Minimal static server for tests and fidelity runs (port 5199 by default).
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.wasm': 'application/wasm' }

export function startServer(port = Number(process.env.PORT ?? 5199)) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      let path = normalize(join(root, decodeURIComponent(url.pathname)))
      if (!path.startsWith(root)) { res.writeHead(403).end(); return }
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html')
      const body = await readFile(path)
      res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer()
  console.log(`serving ${root} on http://127.0.0.1:${server.address().port}`)
}
