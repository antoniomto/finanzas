import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { JSONFilePreset } from 'lowdb/node'
import { nanoid } from 'nanoid'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'credits.json')
const defaultData = { tarjetas: [], estados: [], creditos: [] }
let db

export async function initCreditsStorage() {
  db = await JSONFilePreset(dbPath, defaultData)
  return db
}

/* ─── TARJETAS ─── */

export async function addTarjeta(data) {
  const tarjeta = { id: nanoid(), timestamp: new Date().toISOString(), tarjetahabientes: [], ...data }
  db.data.tarjetas.push(tarjeta)
  await db.write()
  return tarjeta
}

export function getAllTarjetas() {
  return db.data.tarjetas
}

export function findTarjeta(banco, ultimos4) {
  if (!banco || !ultimos4) return null
  return db.data.tarjetas.find(
    (t) => t.banco?.toLowerCase() === banco?.toLowerCase() && t.ultimos4 === ultimos4
  ) || null
}

export async function updateTarjeta(id, patch) {
  const idx = db.data.tarjetas.findIndex((t) => t.id === id)
  if (idx === -1) return null
  db.data.tarjetas[idx] = { ...db.data.tarjetas[idx], ...patch }
  await db.write()
  return db.data.tarjetas[idx]
}

export async function deleteTarjeta(id) {
  const before = db.data.tarjetas.length
  db.data.tarjetas = db.data.tarjetas.filter((t) => t.id !== id)
  if (db.data.tarjetas.length === before) return false
  db.data.estados = db.data.estados.filter((e) => e.tarjeta_id !== id)
  db.data.creditos = db.data.creditos.filter((c) => c.tarjeta_id !== id)
  await db.write()
  return true
}

/* ─── ESTADOS ─── */

export async function addEstado(data) {
  const existing = data.tarjeta_id && data.fecha_corte
    ? db.data.estados.find((e) => e.tarjeta_id === data.tarjeta_id && e.fecha_corte === data.fecha_corte)
    : null

  if (existing) {
    const idx = db.data.estados.findIndex((e) => e.id === existing.id)
    db.data.estados[idx] = { ...existing, ...data, id: existing.id, timestamp: existing.timestamp }
    await db.write()
    return db.data.estados[idx]
  }

  const estado = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    por_persona: [],
    pagos_recibidos: [],
    creditos_msi: [],
    pagado: null,
    fecha_pago_real: null,
    ...data,
  }
  db.data.estados.unshift(estado)
  await db.write()
  return estado
}

export async function syncMsiFromEstado(tarjeta_id, creditos_msi, moneda = 'MXN') {
  if (!Array.isArray(creditos_msi) || creditos_msi.length === 0) return

  for (const msi of creditos_msi) {
    if (!msi.concepto) continue

    const existing = db.data.creditos.find((c) => {
      if (c.tarjeta_id !== tarjeta_id) return false
      const sameConcept = c.concepto?.toLowerCase().includes(msi.concepto.toLowerCase().slice(0, 10)) ||
        msi.concepto.toLowerCase().includes((c.concepto || '').toLowerCase().slice(0, 10))
      if (!sameConcept) return false
      if (msi.monto_original != null && c.total != null) {
        return Math.abs(c.total - msi.monto_original) / Math.max(c.total, 1) < 0.05
      }
      return true
    })

    const meses_pagados = Math.max(0, (msi.numero_mensualidad || 1) - 1)

    if (existing) {
      const idx = db.data.creditos.findIndex((c) => c.id === existing.id)
      db.data.creditos[idx] = {
        ...db.data.creditos[idx],
        meses_pagados,
        mensualidad: msi.pago_requerido ?? db.data.creditos[idx].mensualidad,
        saldo_pendiente: msi.saldo_pendiente ?? db.data.creditos[idx].saldo_pendiente,
      }
    } else if (msi.saldo_pendiente > 0) {
      const credito = {
        id: nanoid(),
        timestamp: new Date().toISOString(),
        concepto: msi.concepto,
        tarjeta_id,
        total: msi.monto_original ?? null,
        meses_totales: msi.meses_totales ?? null,
        meses_pagados,
        mensualidad: msi.pago_requerido ?? null,
        fecha_inicio: msi.fecha_inicio ?? null,
        moneda,
        con_intereses: msi.con_intereses ?? false,
        tasa: msi.tasa ?? 0,
      }
      db.data.creditos.unshift(credito)
    }
  }

  await db.write()
}

function estadosByMes(tarjeta_id, mes) {
  let list = db.data.estados.filter((e) => e.tarjeta_id === tarjeta_id)
  if (mes) list = list.filter((e) => e.fecha_corte?.slice(0, 7) === mes)
  return list
}

function ultimoEstado(tarjeta_id, mes) {
  return estadosByMes(tarjeta_id, mes)[0] || null
}

export function getUltimoEstado(tarjeta_id) {
  return ultimoEstado(tarjeta_id, null)
}

export function getEstadosDespuesDe(tarjeta_id, fecha) {
  return db.data.estados.filter(
    (e) => e.tarjeta_id === tarjeta_id && e.fecha_corte && e.fecha_corte > fecha
  )
}

export function getAllEstados(mes) {
  let list = db.data.estados
  if (mes) list = list.filter((e) => e.fecha_corte?.slice(0, 7) === mes)
  return list
}

/* ─── CRÉDITOS ─── */

export async function addCredito(data) {
  const credito = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    meses_pagados: 0,
    ...data,
  }
  db.data.creditos.unshift(credito)
  await db.write()
  return credito
}

function creditoActivoEnMes(c, mes) {
  if (!mes) return true
  if (!c.fecha_inicio) return true
  const [y, m] = mes.split('-').map(Number)
  const mesDate = new Date(y, m - 1, 1)
  const inicio = new Date(c.fecha_inicio)
  const fin = new Date(inicio.getFullYear(), inicio.getMonth() + (c.meses_totales || 0), 1)
  return inicio <= mesDate && mesDate < fin
}

export function getCreditos({ mes } = {}) {
  return db.data.creditos.filter((c) => creditoActivoEnMes(c, mes))
}

export async function updateCredito(id, patch) {
  const idx = db.data.creditos.findIndex((c) => c.id === id)
  if (idx === -1) return null
  db.data.creditos[idx] = { ...db.data.creditos[idx], ...patch }
  await db.write()
  return db.data.creditos[idx]
}

export async function deleteCredito(id) {
  const before = db.data.creditos.length
  db.data.creditos = db.data.creditos.filter((c) => c.id !== id)
  if (db.data.creditos.length === before) return false
  await db.write()
  return true
}

/* ─── RESUMEN (para cards) ─── */

export function getResumenTarjetas(mes) {
  const allCreditos = getCreditos({ mes })
  return db.data.tarjetas.map((t) => {
    const estado = ultimoEstado(t.id, mes)
    const creditosActivos = allCreditos.filter((c) => c.tarjeta_id === t.id)
    return { ...t, estado, creditosActivos }
  })
}
