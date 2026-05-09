import cron from 'node-cron'
import { getAllTarjetas, getUltimoEstado, getEstadosDespuesDe } from './credits-storage.js'
import { getSock, getOwnerJid } from './whatsapp.js'

function diasHasta(fechaStr) {
  if (!fechaStr) return null
  const target = new Date(fechaStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function fmtMonto(n) {
  if (n == null) return 'N/D'
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function runSchedulerChecks() {
  const jid = getOwnerJid()
  if (!jid) return

  let sock
  try {
    sock = getSock()
  } catch {
    return
  }

  const tarjetas = getAllTarjetas()
  const mensajes = []

  for (const t of tarjetas) {
    const estado = getUltimoEstado(t.id)
    if (!estado) continue

    const label = `${t.banco || 'Tarjeta'} *${t.ultimos4 || '??'}`

    // ── Alerta de pago próximo ──
    const diasPago = diasHasta(estado.fecha_limite_pago)
    if (diasPago !== null) {
      if (diasPago === 3) {
        const pagoTotal = estado.pagos_requeridos?.para_no_generar_intereses ?? estado.saldo_total
        const pagoMin = estado.pagos_requeridos?.pago_minimo ?? estado.pago_minimo
        let msg = `⚠️ ${label} — vence en 3 días (${fmtDate(estado.fecha_limite_pago)})\n`
        msg += `Pago sin intereses: ${fmtMonto(pagoTotal)}`
        if (pagoMin != null) msg += `\nPago mínimo: ${fmtMonto(pagoMin)}`
        mensajes.push(msg)
      } else if (diasPago === 0) {
        const pagoTotal = estado.pagos_requeridos?.para_no_generar_intereses ?? estado.saldo_total
        let msg = `🚨 ${label} — VENCE HOY\n`
        msg += `Pago sin intereses: ${fmtMonto(pagoTotal)}`
        mensajes.push(msg)
      }
    }

    // ── Alerta de estado faltante ──
    const siguienteCorte = estado.siguiente_corte || (estado.fecha_corte ? addDays(estado.fecha_corte, 31) : null)
    if (!siguienteCorte) continue

    const diasSiguiente = diasHasta(siguienteCorte)
    if (diasSiguiente !== null && diasSiguiente < 0) {
      const estadosPosterior = getEstadosDespuesDe(t.id, estado.fecha_corte)
      if (estadosPosterior.length === 0) {
        const msg = `📋 ${label} — ya pasó la fecha de corte esperada (${fmtDate(siguienteCorte)})\n¿Ya tienes tu estado de cuenta? Súbelo para mantener el registro.`
        mensajes.push(msg)
      }
    }
  }

  for (const msg of mensajes) {
    try {
      await sock.sendMessage(jid, { text: msg })
    } catch (err) {
      console.error('[Scheduler] Error enviando mensaje:', err.message)
    }
  }
}

export function initScheduler() {
  cron.schedule('0 9 * * *', runSchedulerChecks, { timezone: 'America/Mexico_City' })
  console.log('[Scheduler] Recordatorios activados — corre diariamente a las 9:00 AM')
}
