import 'dotenv/config'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import express from 'express'
import { Server } from 'socket.io'
import { connectToWhatsApp, getWAState } from './src/whatsapp.js'
import { initStorage, getAll, getStats, updateExpense, deleteExpense } from './src/storage.js'
import {
  initCreditsStorage,
  getResumenTarjetas, getAllTarjetas, addTarjeta, updateTarjeta, deleteTarjeta,
  addEstado, syncMsiFromEstado,
  getCreditos, addCredito, updateCredito, deleteCredito,
  getAllEstados,
} from './src/credits-storage.js'
import { initScheduler, runSchedulerChecks } from './src/scheduler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

app.use(express.json())
app.use(express.static(join(__dirname, 'public')))

io.on('connection', (socket) => {
  const { status, qr } = getWAState()
  socket.emit('wa-status', status)
  if (qr) socket.emit('qr', qr)
})

app.get('/api/expenses', (req, res) => {
  const { mes, page, limit } = req.query
  res.json(getAll({ mes, page: Number(page) || 1, limit: Number(limit) || 15 }))
})

app.get('/api/stats', (req, res) => {
  res.json(getStats(req.query.mes || null))
})

app.put('/api/expenses/:id', async (req, res) => {
  const updated = await updateExpense(req.params.id, req.body)
  if (!updated) return res.status(404).json({ error: 'Not found' })
  io.emit('expense-updated', updated)
  res.json(updated)
})

app.delete('/api/expenses/:id', async (req, res) => {
  const ok = await deleteExpense(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Not found' })
  io.emit('expense-deleted', req.params.id)
  res.json({ ok: true })
})

/* ─── CREDITS API ─── */

app.get('/api/credits/tarjetas', (req, res) => {
  res.json(getResumenTarjetas(req.query.mes || null))
})

app.post('/api/credits/tarjetas', async (req, res) => {
  const t = await addTarjeta(req.body)
  res.json(t)
})

app.put('/api/credits/tarjetas/:id', async (req, res) => {
  const t = await updateTarjeta(req.params.id, req.body)
  if (!t) return res.status(404).json({ error: 'Not found' })
  res.json(t)
})

app.delete('/api/credits/tarjetas/:id', async (req, res) => {
  const ok = await deleteTarjeta(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.post('/api/credits/estados', async (req, res) => {
  const e = await addEstado(req.body)
  await syncMsiFromEstado(e.tarjeta_id, e.creditos_msi, e.moneda)
  io.emit('estado-updated', { tarjeta_id: e.tarjeta_id, estado: e })
  res.json(e)
})

app.get('/api/credits/creditos', (req, res) => {
  res.json(getCreditos({ mes: req.query.mes || null }))
})

app.post('/api/credits/creditos', async (req, res) => {
  const c = await addCredito(req.body)
  io.emit('credito-added', c)
  res.json(c)
})

app.put('/api/credits/creditos/:id', async (req, res) => {
  const c = await updateCredito(req.params.id, req.body)
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c)
})

app.delete('/api/credits/creditos/:id', async (req, res) => {
  const ok = await deleteCredito(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

/* ─── REPORTS API ─── */

const ADICIONALES_REPORTE = ['cyntia', 'karla']

app.get('/api/reports/cyntia', (req, res) => {
  const mes = req.query.mes || null
  const tarjetas = getAllTarjetas()
  const estados = getAllEstados(mes)

  const periodos = []
  for (const estado of estados) {
    const tarjeta = tarjetas.find((t) => t.id === estado.tarjeta_id)
    if (!tarjeta) continue
    for (const persona of (estado.por_persona || [])) {
      const nombre = (persona.nombre || '').toLowerCase()
      if (!ADICIONALES_REPORTE.some((n) => nombre.includes(n))) continue
      periodos.push({
        tarjeta_id: tarjeta.id,
        banco: tarjeta.banco || estado.banco || '',
        nombre_tarjeta: tarjeta.nombre || '',
        ultimos4: tarjeta.ultimos4 || '',
        fecha_corte: estado.fecha_corte,
        fecha_limite_pago: estado.fecha_limite_pago,
        nombre_adicional: persona.nombre,
        total: persona.total ?? 0,
        adeudo_10pct: Math.round((persona.total ?? 0) * 0.10 * 100) / 100,
      })
    }
  }

  periodos.sort((a, b) => (b.fecha_corte || '').localeCompare(a.fecha_corte || ''))
  const total_adeudo = Math.round(periodos.reduce((s, p) => s + p.adeudo_10pct, 0) * 100) / 100
  res.json({ periodos, total_adeudo, mes })
})

/* ─── DEBUG ─── */

app.get('/api/debug/run-scheduler', async (req, res) => {
  try {
    await runSchedulerChecks()
    res.json({ ok: true, message: 'Scheduler ejecutado manualmente' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function start() {
  await initStorage()
  await initCreditsStorage()
  await connectToWhatsApp(io)
  initScheduler()

  httpServer.listen(PORT, () => {
    console.log(`\nPanel web disponible en http://localhost:${PORT}`)
    console.log('Abre el navegador y escanea el QR de WhatsApp desde el panel.\n')
  })
}

start().catch(console.error)
