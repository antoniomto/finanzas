import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseTicket, parseEstadoCuenta } from './gemini.js'
import { addExpense } from './storage.js'
import { findTarjeta, addTarjeta, updateTarjeta, addEstado, syncMsiFromEstado } from './credits-storage.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const uploadsDir = join(__dirname, '..', 'public', 'uploads')
mkdirSync(uploadsDir, { recursive: true })

const TARGET_GROUP_NAME = 'Gastos Mata Vera'
const PERSONAL_JID = process.env.MY_NUMBER || null

let sockInstance = null
let ioInstance = null
let currentQR = null
let currentStatus = 'disconnected'
let targetGroupJid = null
let ownerJid = PERSONAL_JID || null

export function getWAState() {
  return { status: currentStatus, qr: currentQR }
}

export async function connectToWhatsApp(io) {
  ioInstance = io
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  })

  sockInstance = sock

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      currentQR = qr
      currentStatus = 'disconnected'
      io.emit('qr', qr)
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      currentStatus = 'disconnected'
      currentQR = null
      io.emit('wa-status', 'disconnected')

      if (shouldReconnect) {
        connectToWhatsApp(io)
      } else {
        console.log('[WA] Sesión cerrada. Elimina auth_info_baileys/ y reinicia.')
      }
    } else if (connection === 'open') {
      console.log('[WA] Conexión establecida.')
      currentStatus = 'connected'
      currentQR = null
      io.emit('wa-status', 'connected')
    } else if (connection === 'connecting') {
      currentStatus = 'connecting'
      io.emit('wa-status', 'connecting')
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      if (m.key.fromMe) continue

      const from = m.key.remoteJid

      // Permitir solo: chat personal o el grupo objetivo
      const isGroup    = from.endsWith('@g.us')
      if (!isGroup && !ownerJid) ownerJid = from
      if (!isGroup) console.log(`[WA] Mensaje directo recibido de JID: ${from}`)
      const isPersonal = PERSONAL_JID ? from === PERSONAL_JID : false

      if (!isPersonal && !isGroup) continue

      if (isGroup) {
        if (targetGroupJid && from !== targetGroupJid) continue

        if (!targetGroupJid) {
          try {
            const meta = await sock.groupMetadata(from)
            if (meta.subject !== TARGET_GROUP_NAME) continue
            targetGroupJid = from
            console.log(`[WA] Grupo "${TARGET_GROUP_NAME}" identificado: ${from}`)
          } catch {
            continue
          }
        }
      }

      const msgContent = m.message

      if (!msgContent) continue

      // ── PDF: estado de cuenta (solo número personal) ──
      const docMsg = msgContent.documentMessage
      if (isPersonal && docMsg && docMsg.mimetype === 'application/pdf') {
        try {
          await sock.sendMessage(from, { text: 'Leyendo estado de cuenta...' })
          const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) })
          const data = await parseEstadoCuenta(buffer)

          let tarjeta = findTarjeta(data.banco, data.ultimos4)
          if (!tarjeta) {
            tarjeta = await addTarjeta({
              nombre: data.nombre_tarjeta || `${data.banco || 'Tarjeta'} *${data.ultimos4 || '????'}`,
              banco: data.banco || '',
              ultimos4: data.ultimos4 || '',
              moneda: data.moneda || 'MXN',
              limite: data.limite_credito ?? null,
            })
          } else {
            const patch = {}
            if (data.limite_credito && !tarjeta.limite) patch.limite = data.limite_credito
            if (data.titular && !tarjeta.titular) patch.titular = data.titular
            if (Object.keys(patch).length) await updateTarjeta(tarjeta.id, patch)
          }

          const moneda = data.moneda || 'MXN'

          const por_persona = (data.por_persona || []).map((p) => ({
            nombre: p.nombre,
            tipo: p.tipo || 'adicional',
            total: p.total,
            es_credito_neto: p.es_credito_neto || false,
          }))

          const fechaCorte = data.fechas?.corte || data.fecha_corte || null
          const fechaLimite = data.fechas?.limite_pago || data.fecha_limite_pago || null
          const pagoSinInt = data.pagos_requeridos?.para_no_generar_intereses ?? data.saldo_total ?? null
          const pagoMinimo = data.pagos_requeridos?.pago_minimo ?? data.pago_minimo ?? null

          const estado = await addEstado({
            tarjeta_id: tarjeta.id,
            banco: data.banco,
            fecha_corte: fechaCorte,
            fecha_limite_pago: fechaLimite,
            siguiente_corte: data.fechas?.siguiente_corte ?? null,
            saldo_total: pagoSinInt,
            pago_minimo: pagoMinimo,
            periodo: data.periodo ?? null,
            resumen: data.resumen ?? null,
            pagos_requeridos: data.pagos_requeridos ?? null,
            limite_credito: data.limite_credito ?? null,
            por_persona,
            pagos_recibidos: data.pagos_recibidos ?? [],
            creditos_msi: data.creditos_msi ?? [],
          })

          await syncMsiFromEstado(tarjeta.id, data.creditos_msi || [], moneda)

          ioInstance.emit('estado-updated', { tarjeta_id: tarjeta.id, estado })

          const fmt = (n) => n != null ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : 'N/D'
          const fmtDate = (s) => s ? s.split('-').reverse().join('/') : 'N/D'
          const banco = data.banco || 'Tarjeta'
          const tarjLabel = `${banco} *${data.ultimos4 || '??'}`
          const periodo = data.periodo ? `${fmtDate(data.periodo.inicio)} → ${fmtDate(data.periodo.fin)}` : ''
          const msiList = data.creditos_msi || []
          const msiCount = msiList.length
          const msiPend = msiList.reduce((s, m) => s + (m.saldo_pendiente || 0), 0)
          const msiConInt = msiList.filter((m) => m.con_intereses)

          let resumen = `✓ ${tarjLabel}${periodo ? ` — ${periodo}` : ''}\n`
          resumen += `Pagar antes del ${fmtDate(fechaLimite)}: ${fmt(pagoSinInt)}\n`
          if (pagoMinimo != null) resumen += `(mín: ${fmt(pagoMinimo)})\n`

          if (data.resumen?.pagos_y_abonos) resumen += `\nPagos recibidos: ${fmt(data.resumen.pagos_y_abonos)}`
          if (data.resumen?.intereses) resumen += `\nIntereses del periodo: ${fmt(data.resumen.intereses)}`

          if (por_persona.length > 0) {
            resumen += '\n\nPor persona:'
            por_persona.forEach((p) => {
              const tag = p.tipo === 'titular' ? '(titular)' : ''
              const cr = p.es_credito_neto ? ' *' : ''
              resumen += `\n• ${p.nombre} ${tag}: ${fmt(p.total)}${cr}`
            })
          }

          if (msiCount > 0) {
            resumen += `\n\nMSI activos: ${msiCount} planes · ${fmt(msiPend)} pend.`
            if (msiConInt.length > 0) {
              msiConInt.forEach((m) => {
                resumen += `\n⚠️ ${m.concepto}: pago ${m.numero_mensualidad}/${m.meses_totales} con intereses (${m.tasa}%)`
              })
            }
          }

          await sock.sendMessage(from, { text: resumen })
        } catch (err) {
          console.error('[WA] Error procesando estado de cuenta:', err.message)
          await sock.sendMessage(from, { text: 'No pude leer el estado de cuenta. Asegúrate de enviar el PDF original.' })
        }
        continue
      }

      // ── Imagen: ticket de compra ──
      const imageMsg =
        msgContent.imageMessage ||
        msgContent.viewOnceMessage?.message?.imageMessage ||
        msgContent.viewOnceMessageV2?.message?.imageMessage

      if (!imageMsg) continue

      try {
        await sock.sendMessage(from, { text: 'Analizando tu ticket...' })

        const buffer = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) })
        const mimeType = imageMsg.mimetype || 'image/jpeg'
        const ext = mimeType.includes('png') ? 'png' : 'jpg'

        const data = await parseTicket(buffer, mimeType)

        const tempId = Date.now()
        const imgFilename = `ticket-${tempId}.${ext}`
        const imgPath = join(uploadsDir, imgFilename)
        writeFileSync(imgPath, buffer)

        const saved = await addExpense({ ...data, imagenUrl: `/uploads/${imgFilename}` })
        ioInstance.emit('new-expense', saved)

        const moneda = data.moneda || 'MXN'
        const total = data.total != null ? `${data.total} ${moneda}` : 'importe no detectado'
        const comercio = data.comercio || 'comercio no identificado'
        const categoria = data.categoria || 'Otros'

        await sock.sendMessage(from, {
          text: `Gasto registrado\n${comercio} — ${total}\nCategoria: ${categoria}`,
        })
      } catch (err) {
        console.error('[WA] Error procesando ticket:', err.message)
        await sock.sendMessage(from, {
          text: 'No pude leer el ticket. Intenta con mejor iluminación o ángulo.',
        })
      }
    }
  })

  return sock
}

export function getSock() {
  if (!sockInstance) throw new Error('WhatsApp no está conectado todavía')
  return sockInstance
}

export function getOwnerJid() {
  return ownerJid
}
