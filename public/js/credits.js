/* ─── CREDITS STATE ─── */

let currentCreditMes = new Date().toISOString().slice(0, 7)
const TODAY_CREDIT_MES = new Date().toISOString().slice(0, 7)

let allTarjetas = []

/* ─── MONTH NAV ─── */

function renderCreditMonthNav() {
  const label = document.getElementById('credit-month-label')
  const nextBtn = document.getElementById('credit-next-month')
  if (label) label.textContent = formatMesLabel(currentCreditMes)
  if (nextBtn) nextBtn.disabled = currentCreditMes >= TODAY_CREDIT_MES
}

function shiftCreditMonth(delta) {
  const [y, m] = currentCreditMes.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  currentCreditMes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  loadCreditsData()
}

/* ─── DATA LOADING ─── */

async function loadCreditsData() {
  renderCreditMonthNav()
  try {
    const [tarjetasRes, creditosRes] = await Promise.all([
      fetch(`/api/credits/tarjetas?mes=${currentCreditMes}`),
      fetch(`/api/credits/creditos?mes=${currentCreditMes}`),
    ])
    allTarjetas = await tarjetasRes.json()
    const creditos = await creditosRes.json()
    renderTarjetaCards(allTarjetas)
    renderCreditosTable(creditos)
    populateTarjetaSelect()
  } catch (err) {
    console.error('Error cargando créditos:', err)
  }
}

/* ─── TDC CARDS ─── */

function utilColor(pct) {
  if (pct < 30) return 'green'
  if (pct < 70) return 'yellow'
  return 'red'
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

function buildTarjetaCard(t) {
  const estado = t.estado
  const saldo = estado?.saldo_total ?? null
  const limite = t.limite ?? null
  const moneda = t.moneda || 'MXN'
  const porPersona = estado?.por_persona || []
  const creditosActivos = t.creditosActivos || []

  const pct = (saldo != null && limite) ? Math.min(100, Math.round((saldo / limite) * 100)) : 0
  const color = utilColor(pct)
  const sobregiro = limite && saldo != null && saldo > limite

  const days = daysUntil(estado?.fecha_limite_pago)
  const urgent = days !== null && days <= 3
  const fechaLabel = estado?.fecha_limite_pago ? formatDate(estado.fecha_limite_pago) : '—'

  const personaCount = porPersona.length
  const msiCount = creditosActivos.length
  const hasEstado = !!estado

  const card = document.createElement('div')
  card.className = 'tdc-card'
  card.dataset.id = t.id
  card.innerHTML = `
    <div class="tdc-card-header">
      <div>
        <div class="tdc-card-name">${t.nombre}</div>
        <div class="tdc-card-bank">${t.banco || ''} ${t.ultimos4 ? `*${t.ultimos4}` : ''}</div>
      </div>
      <div class="tdc-card-actions">
        <button class="action-btn edit-btn" title="Editar" onclick='openTarjetaModal(${JSON.stringify(t).replace(/'/g, "&#39;")})'><i class="ph-bold ph-pencil-simple"></i></button>
        <button class="action-btn delete-btn" title="Eliminar" onclick="confirmDeleteTarjeta('${t.id}', this)"><i class="ph-bold ph-trash"></i></button>
      </div>
    </div>
    <div class="util-section">
      <div class="util-row">
        <span class="util-saldo">${saldo != null ? formatCurrency(saldo, moneda) : '—'}</span>
        <span class="util-limite">${limite ? `de ${formatCurrency(limite, moneda)}` : 'sin límite'}</span>
      </div>
      ${(saldo != null && limite) ? `
        <div class="util-bar-track">
          <div class="util-bar-fill ${color}" style="width: ${pct}%"></div>
        </div>
        ${sobregiro ? '<div class="sobregiro-badge">⚠ Sobregiro</div>' : ''}
      ` : ''}
    </div>
    ${hasEstado ? `
      <div class="tdc-pago-row">
        <span>Pagar antes del ${fechaLabel}:</span>
        <span class="tdc-pago-amount ${urgent ? 'urgent' : ''}">${formatCurrency(saldo, moneda)}</span>
      </div>
      ${personaCount > 0 ? `<div class="tdc-msi-count">${personaCount} tarjetahabiente${personaCount !== 1 ? 's' : ''}</div>` : ''}
      ${msiCount > 0 ? `<div class="tdc-msi-count">${msiCount} MSI activo${msiCount !== 1 ? 's' : ''}</div>` : ''}
      <button class="btn-ver-estado" onclick="openCardDrawer('${t.id}')">Ver estado <i class="ph-bold ph-arrow-right"></i></button>
    ` : '<div class="tdc-pago-row" style="color:var(--text-tertiary)">Sin estado de cuenta este mes</div>'}
  `
  return card
}

/* ─── DRAWER ─── */

function openCardDrawer(tarjetaId) {
  const t = allTarjetas.find((t) => t.id === tarjetaId)
  if (!t) return

  document.getElementById('drawer-banco').textContent = t.banco || ''
  document.getElementById('drawer-title').textContent = t.nombre || ''
  document.getElementById('drawer-body').innerHTML = buildDrawerContent(t)

  const backdrop = document.getElementById('card-drawer-backdrop')
  backdrop.classList.add('open')
  backdrop.setAttribute('aria-hidden', 'false')
}

function closeCardDrawer() {
  const backdrop = document.getElementById('card-drawer-backdrop')
  backdrop.classList.remove('open')
  backdrop.setAttribute('aria-hidden', 'true')
}

function buildDrawerContent(t) {
  const estado = t.estado
  if (!estado) return '<div style="color:var(--text-tertiary);padding:20px 0">Sin estado de cuenta registrado.</div>'

  const moneda = t.moneda || 'MXN'
  const fmt = (n) => n != null ? formatCurrency(n, moneda) : '—'
  const fmtShortDate = (s) => {
    if (!s) return '—'
    const [y, m, d] = s.split('-')
    const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
    return `${parseInt(d)} ${months[parseInt(m)-1]}`
  }

  const sections = []

  // ─── SECCIÓN 1: PERÍODO ───
  const per = estado.periodo
  const fechaLimite = estado.fecha_limite_pago
  const days = daysUntil(fechaLimite)
  const urgente = days !== null && days <= 3
  const daysTxt = days != null ? (days === 0 ? 'hoy' : days < 0 ? `hace ${Math.abs(days)} días` : `en ${days} días`) : ''

  let periodoHtml = '<div class="drawer-section">'
  periodoHtml += '<div class="drawer-section-title">Período</div>'
  if (per?.inicio && per?.fin) {
    periodoHtml += `<div class="drawer-periodo-range">${fmtShortDate(per.inicio)} → ${fmtShortDate(per.fin)}${per.dias ? ` · ${per.dias} días` : ''}</div>`
  } else if (estado.fecha_corte) {
    periodoHtml += `<div class="drawer-periodo-range">Corte: ${fmtShortDate(estado.fecha_corte)}</div>`
  }
  if (fechaLimite) {
    periodoHtml += `<div class="drawer-periodo-pago${urgente ? ' urgente' : ''}">Pagar antes del ${fmtShortDate(fechaLimite)}${daysTxt ? ` (${daysTxt})` : ''}</div>`
  }
  periodoHtml += '</div>'
  sections.push(periodoHtml)

  // ─── SECCIÓN 2: RESUMEN ───
  const res = estado.resumen
  const pr = estado.pagos_requeridos
  const hasSaldoAnterior = res?.saldo_anterior != null
  const hasResumen = res && Object.values(res).some((v) => v != null && v !== 0)

  let resumenHtml = '<div class="drawer-section">'
  resumenHtml += '<div class="drawer-section-title">Resumen del período</div>'

  if (hasResumen) {
    resumenHtml += '<table class="drawer-resumen">'
    if (hasSaldoAnterior) resumenHtml += `<tr><td>Saldo anterior</td><td>${fmt(res.saldo_anterior)}</td></tr>`
    if (res?.cargos_regulares) resumenHtml += `<tr><td>+ Nuevos cargos</td><td>${fmt(res.cargos_regulares)}</td></tr>`
    if (res?.cargos_msi_capital) resumenHtml += `<tr><td>+ MSI (capital)</td><td>${fmt(res.cargos_msi_capital)}</td></tr>`
    if (res?.intereses) resumenHtml += `<tr><td>+ Intereses</td><td>${fmt(res.intereses)}</td></tr>`
    if (res?.comisiones) resumenHtml += `<tr><td>+ Comisiones</td><td>${fmt(res.comisiones)}</td></tr>`
    if (res?.iva) resumenHtml += `<tr><td>+ IVA</td><td>${fmt(res.iva)}</td></tr>`
    if (res?.pagos_y_abonos) resumenHtml += `<tr><td>− Pagos recibidos</td><td>${fmt(res.pagos_y_abonos)}</td></tr>`
    if (estado.saldo_total != null) {
      resumenHtml += `<tr class="separator-row total-row"><td>Saldo actual</td><td>${fmt(estado.saldo_total)}</td></tr>`
    }
    resumenHtml += '</table>'
  } else if (estado.saldo_total != null) {
    resumenHtml += `<div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">${fmt(estado.saldo_total)}</div>`
  }

  if (pr || estado.saldo_total != null) {
    const pagoTotal = pr?.para_no_generar_intereses ?? estado.saldo_total
    const pagoMin = pr?.pago_minimo ?? estado.pago_minimo
    const pagoMedMiddle = pr?.pago_minimo_mas_meses

    resumenHtml += '<div class="drawer-pagos-requeridos">'
    if (pagoTotal != null) {
      resumenHtml += `<div class="drawer-pago-req-row principal"><span class="drawer-pago-req-label">Para no generar intereses</span><span class="drawer-pago-req-amount">${fmt(pagoTotal)}</span></div>`
    }
    if (pagoMedMiddle != null) {
      resumenHtml += `<div class="drawer-pago-req-row"><span class="drawer-pago-req-label">Pago mínimo + meses</span><span class="drawer-pago-req-amount">${fmt(pagoMedMiddle)}</span></div>`
    }
    if (pagoMin != null) {
      resumenHtml += `<div class="drawer-pago-req-row"><span class="drawer-pago-req-label">Pago mínimo</span><span class="drawer-pago-req-amount">${fmt(pagoMin)}</span></div>`
    }
    resumenHtml += '</div>'
  }

  resumenHtml += '</div>'
  sections.push(resumenHtml)

  // ─── SECCIÓN 3: PAGOS RECIBIDOS ───
  const pagosRecibidos = estado.pagos_recibidos || []
  if (pagosRecibidos.length > 0) {
    let pagosHtml = '<div class="drawer-section">'
    pagosHtml += '<div class="drawer-section-title">Pagos recibidos</div>'
    pagosHtml += '<div class="drawer-pagos-list">'
    pagosRecibidos.forEach((p) => {
      pagosHtml += `
        <div class="drawer-pago-row">
          <span class="drawer-pago-fecha">${fmtShortDate(p.fecha)}</span>
          <span class="drawer-pago-desc">${p.descripcion || ''}</span>
          <span class="drawer-pago-amount">${fmt(p.monto)}</span>
        </div>`
    })
    pagosHtml += '</div></div>'
    sections.push(pagosHtml)
  }

  // ─── SECCIÓN 4: POR PERSONA ───
  const porPersona = estado.por_persona || []
  if (porPersona.length > 0) {
    let personasHtml = '<div class="drawer-section">'
    personasHtml += '<div class="drawer-section-title">Por tarjetahabiente</div>'
    porPersona.forEach((p) => {
      const badge = p.tipo === 'titular'
        ? '<span class="badge-titular">Titular</span>'
        : '<span class="badge-adicional">Adicional</span>'
      const crNote = p.es_credito_neto
        ? '<span class="drawer-persona-cr">balance favorable</span>'
        : ''
      personasHtml += `
        <div class="drawer-persona-row">
          ${badge}
          <span class="drawer-persona-name">${p.nombre}</span>
          ${crNote}
          <span class="drawer-persona-amount">${fmt(p.total)}</span>
        </div>`
    })
    personasHtml += '</div>'
    sections.push(personasHtml)
  }

  // ─── SECCIÓN 5: MSI ───
  const msiList = estado.creditos_msi || []
  if (msiList.length > 0) {
    const sinInteres = msiList.filter((m) => !m.con_intereses)
    const conInteres = msiList.filter((m) => m.con_intereses)

    let msiHtml = '<div class="drawer-section">'
    msiHtml += '<div class="drawer-section-title">Compras a meses</div>'

    const renderMsiRows = (list) => list.map((m) => {
      const num = m.numero_mensualidad || 0
      const tot = m.meses_totales || 1
      const pct = Math.min(100, Math.round((num / tot) * 100))
      const complete = num >= tot
      const intBadge = m.con_intereses ? `<span class="msi-intereses-badge">⚠ ${m.tasa}%</span>` : ''

      return `
        <div class="msi-row">
          <div class="msi-row-main">
            <span class="msi-concepto">${m.concepto || '—'}</span>
            <div class="msi-badges">${intBadge}</div>
            <span class="msi-mensualidad">${fmt(m.pago_requerido)}/mes</span>
          </div>
          <div class="msi-row-detail">
            <div class="msi-progress-wrap">
              <span class="msi-progress-label">${num}/${tot}</span>
              <div class="msi-mini-bar"><div class="msi-mini-fill${complete ? ' complete' : ''}" style="width:${pct}%"></div></div>
            </div>
            <span class="msi-pendiente">${fmt(m.saldo_pendiente)} pend.</span>
          </div>
        </div>`
    }).join('')

    if (sinInteres.length > 0) {
      if (conInteres.length > 0) msiHtml += '<div class="msi-group-title">Sin intereses</div>'
      msiHtml += renderMsiRows(sinInteres)
    }

    if (conInteres.length > 0) {
      msiHtml += '<div class="msi-group-title" style="margin-top:16px;color:#e65100">Con intereses</div>'
      msiHtml += renderMsiRows(conInteres)
    }

    msiHtml += '</div>'
    sections.push(msiHtml)
  }

  return sections.join('')
}

function renderTarjetaCards(tarjetas) {
  const grid = document.getElementById('tdc-cards-grid')
  if (!grid) return
  if (!tarjetas.length) {
    grid.innerHTML = '<div class="tdc-empty">Sin tarjetas registradas. Agrega una o envía un estado de cuenta por WhatsApp.</div>'
    return
  }
  grid.innerHTML = ''
  tarjetas.forEach((t) => grid.appendChild(buildTarjetaCard(t)))
}

function refreshTarjetaCard(tarjeta_id) {
  fetch(`/api/credits/tarjetas?mes=${currentCreditMes}`)
    .then((r) => r.json())
    .then((data) => {
      allTarjetas = data
      renderTarjetaCards(data)
    })
    .catch(() => {})
}

/* ─── CRÉDITOS TABLE ─── */

function buildCreditoRow(c) {
  const tarjeta = allTarjetas.find((t) => t.id === c.tarjeta_id)
  const tarjetaLabel = tarjeta ? `${tarjeta.nombre}` : '—'
  const moneda = tarjeta?.moneda || 'MXN'
  const mesesPagados = c.meses_pagados || 0
  const mesesTotales = c.meses_totales || 1
  const pct = Math.min(100, Math.round((mesesPagados / mesesTotales) * 100))
  const mesesRestantes = Math.max(0, mesesTotales - mesesPagados)
  const pendiente = mesesRestantes * (c.mensualidad || 0)
  const complete = mesesPagados >= mesesTotales

  const tr = document.createElement('tr')
  tr.dataset.id = c.id
  const cJson = JSON.stringify(c).replace(/'/g, '&#39;')
  tr.innerHTML = `
    <td class="td-comercio">${c.concepto || '—'}</td>
    <td style="font-size:0.8125rem;color:var(--text-secondary)">${tarjetaLabel}</td>
    <td class="td-total">${formatCurrency(c.mensualidad, moneda)}</td>
    <td class="progress-cell">
      <div class="progress-wrap">
        <span class="progress-label">${mesesPagados}/${mesesTotales} meses</span>
        <div class="progress-track">
          <div class="progress-fill ${complete ? 'complete' : ''}" style="width: ${pct}%"></div>
        </div>
      </div>
    </td>
    <td class="td-total" style="${mesesRestantes <= 1 ? 'color:var(--accent-red-text)' : ''}">${formatCurrency(pendiente, moneda)}</td>
    <td class="td-actions">
      <button class="action-btn edit-btn" title="Editar" onclick='openCreditoModal(${cJson})'><i class="ph-bold ph-pencil-simple"></i></button>
      <button class="action-btn delete-btn" title="Eliminar" onclick="confirmDeleteCredito('${c.id}', this)"><i class="ph-bold ph-trash"></i></button>
    </td>
  `
  return tr
}

function renderCreditosTable(creditos) {
  const tbody = document.getElementById('creditos-tbody')
  if (!tbody) return
  if (!creditos.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin créditos registrados</td></tr>'
    return
  }
  tbody.innerHTML = ''
  creditos.forEach((c) => tbody.appendChild(buildCreditoRow(c)))
}

/* ─── TARJETA MODAL ─── */

let adicionalesCount = 0

function openTarjetaModal(tarjeta) {
  adicionalesCount = 0
  document.getElementById('adicionales-list').innerHTML = ''
  document.getElementById('tarjeta-id').value = tarjeta?.id || ''
  document.getElementById('tarjeta-nombre').value = tarjeta?.nombre || ''
  document.getElementById('tarjeta-banco').value = tarjeta?.banco || ''
  document.getElementById('tarjeta-ultimos4').value = tarjeta?.ultimos4 || ''
  document.getElementById('tarjeta-limite').value = tarjeta?.limite ?? ''
  document.getElementById('tarjeta-dia-corte').value = tarjeta?.dia_corte ?? ''
  document.getElementById('tarjeta-dia-pago').value = tarjeta?.dia_pago ?? ''
  document.getElementById('tarjeta-moneda').value = tarjeta?.moneda || 'MXN'
  document.getElementById('tarjeta-modal-title').textContent = tarjeta ? 'Editar tarjeta' : 'Nueva tarjeta'

  if (tarjeta?.tarjetahabientes?.length) {
    tarjeta.tarjetahabientes.forEach((th) => addAdicionalInput(th.nombre))
  }

  const modal = document.getElementById('tarjeta-modal')
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
  document.getElementById('tarjeta-nombre').focus()
}

function closeTarjetaModal() {
  const modal = document.getElementById('tarjeta-modal')
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

function addAdicionalInput(nombre = '') {
  adicionalesCount++
  const id = `adicional-${adicionalesCount}`
  const row = document.createElement('div')
  row.className = 'adicional-row'
  row.id = id
  row.innerHTML = `
    <input class="field-input" type="text" placeholder="Nombre del adicional" value="${nombre}" />
    <button type="button" class="btn-remove-adicional" onclick="document.getElementById('${id}').remove()" title="Eliminar"><i class="ph-bold ph-x"></i></button>
  `
  document.getElementById('adicionales-list').appendChild(row)
}

/* ─── CRÉDITO MODAL ─── */

function populateTarjetaSelect() {
  const sel = document.getElementById('credito-tarjeta')
  if (!sel) return
  const current = sel.value
  sel.innerHTML = '<option value="">Sin tarjeta</option>'
  allTarjetas.forEach((t) => {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = t.nombre
    sel.appendChild(opt)
  })
  if (current) sel.value = current
}

function openCreditoModal(credito) {
  document.getElementById('credito-id').value = credito?.id || ''
  document.getElementById('credito-concepto').value = credito?.concepto || ''
  document.getElementById('credito-tarjeta').value = credito?.tarjeta_id || ''
  document.getElementById('credito-categoria').value = credito?.categoria || 'Electrónica'
  document.getElementById('credito-total').value = credito?.total ?? ''
  document.getElementById('credito-meses').value = credito?.meses_totales ?? ''
  document.getElementById('credito-mensualidad').value = credito?.mensualidad ?? ''
  document.getElementById('credito-fecha-inicio').value = credito?.fecha_inicio || ''
  document.getElementById('credito-meses-pagados').value = credito?.meses_pagados ?? 0
  document.getElementById('credito-modal-title').textContent = credito ? 'Editar crédito' : 'Nuevo crédito / MSI'

  const modal = document.getElementById('credito-modal')
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
  document.getElementById('credito-concepto').focus()
}

function closeCreditoModal() {
  const modal = document.getElementById('credito-modal')
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

/* ─── DELETE HANDLERS ─── */

async function confirmDeleteTarjeta(id, btn) {
  const ok = confirm('¿Eliminar esta tarjeta y todos sus datos asociados? Esta acción no se puede deshacer.')
  if (!ok) return
  try {
    await fetch(`/api/credits/tarjetas/${id}`, { method: 'DELETE' })
    loadCreditsData()
  } catch (err) {
    console.error('Error al eliminar tarjeta:', err)
  }
}

async function confirmDeleteCredito(id, btn) {
  const ok = confirm('¿Eliminar este crédito? Esta acción no se puede deshacer.')
  if (!ok) return
  try {
    await fetch(`/api/credits/creditos/${id}`, { method: 'DELETE' })
    const row = document.querySelector(`tr[data-id="${id}"]`)
    if (row) {
      row.classList.add('row-removing')
      row.addEventListener('animationend', () => row.remove(), { once: true })
    }
  } catch (err) {
    console.error('Error al eliminar crédito:', err)
  }
}

/* ─── AUTO-CALCULATE MENSUALIDAD ─── */

function recalcMensualidad() {
  const total = parseFloat(document.getElementById('credito-total').value)
  const meses = parseInt(document.getElementById('credito-meses').value)
  const mensField = document.getElementById('credito-mensualidad')
  if (total > 0 && meses > 0 && !mensField.dataset.manual) {
    mensField.value = (total / meses).toFixed(2)
  }
}

/* ─── REPORTE CYNTIA ─── */

let currentReporteMes = new Date().toISOString().slice(0, 7)
const TODAY_REPORTE_MES = new Date().toISOString().slice(0, 7)

function renderReporteMonthNav() {
  const label = document.getElementById('reporte-month-label')
  const nextBtn = document.getElementById('reporte-next-month')
  if (label) label.textContent = formatMesLabel(currentReporteMes)
  if (nextBtn) nextBtn.disabled = currentReporteMes >= TODAY_REPORTE_MES
}

function shiftReporteMes(delta) {
  const [y, m] = currentReporteMes.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  currentReporteMes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  loadReporteData()
}

async function loadReporteData() {
  renderReporteMonthNav()
  try {
    const res = await fetch(`/api/reports/cyntia?mes=${currentReporteMes}`)
    const data = await res.json()
    renderReporte(data)
  } catch (err) {
    console.error('Error cargando reporte:', err)
  }
}

function renderReporte(data) {
  const totalCard = document.getElementById('reporte-total-card')
  const totalEl = document.getElementById('reporte-total-amount')
  const tbody = document.getElementById('reporte-tbody')
  if (!tbody) return

  if (data.periodos.length === 0) {
    if (totalCard) totalCard.style.display = 'none'
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin gastos de adicionales este mes</td></tr>'
    return
  }

  if (totalCard) totalCard.style.display = ''
  if (totalEl) totalEl.textContent = formatCurrency(data.total_adeudo, 'MXN')

  tbody.innerHTML = ''
  for (const p of data.periodos) {
    const tr = document.createElement('tr')
    const tarjetaLabel = `${p.banco} *${p.ultimos4 || '??'}`
    const periodo = p.fecha_corte ? formatDate(p.fecha_corte) : '—'
    const fechaLimite = p.fecha_limite_pago ? formatDate(p.fecha_limite_pago) : '—'
    tr.innerHTML = `
      <td class="td-comercio">${tarjetaLabel}</td>
      <td class="td-fecha">${periodo}</td>
      <td>${p.nombre_adicional}</td>
      <td class="td-total">${formatCurrency(p.total, 'MXN')}</td>
      <td class="td-total" style="font-weight:600;color:var(--accent-green-text)">${formatCurrency(p.adeudo_10pct, 'MXN')}</td>
      <td class="td-fecha">${fechaLimite}</td>
    `
    tbody.appendChild(tr)
  }

  // Fila de total
  const trTotal = document.createElement('tr')
  trTotal.className = 'reporte-total-row'
  trTotal.innerHTML = `
    <td colspan="4" style="text-align:right;font-weight:600;padding-top:12px">Total a cobrar:</td>
    <td class="td-total" style="font-weight:700;font-size:1rem;color:var(--accent-green-text)">${formatCurrency(data.total_adeudo, 'MXN')}</td>
    <td></td>
  `
  tbody.appendChild(trTotal)
}

/* ─── INIT CREDITS ─── */

function initCredits() {
  document.getElementById('credit-prev-month').addEventListener('click', () => shiftCreditMonth(-1))
  document.getElementById('credit-next-month').addEventListener('click', () => shiftCreditMonth(1))
  document.getElementById('reporte-prev-month').addEventListener('click', () => shiftReporteMes(-1))
  document.getElementById('reporte-next-month').addEventListener('click', () => shiftReporteMes(1))

  document.getElementById('tarjeta-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTarjetaModal()
  })
  document.getElementById('credito-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCreditoModal()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeTarjetaModal(); closeCreditoModal(); closeCardDrawer() }
  })

  // Auto-calc mensualidad
  const totalInput = document.getElementById('credito-total')
  const mesesInput = document.getElementById('credito-meses')
  const mensInput = document.getElementById('credito-mensualidad')
  totalInput.addEventListener('input', recalcMensualidad)
  mesesInput.addEventListener('input', recalcMensualidad)
  mensInput.addEventListener('input', () => { mensInput.dataset.manual = '1' })

  // Tarjeta form submit
  document.getElementById('tarjeta-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = document.getElementById('tarjeta-id').value

    const adicionales = [...document.querySelectorAll('#adicionales-list .adicional-row input')]
      .map((inp) => inp.value.trim())
      .filter(Boolean)
      .map((nombre, i) => ({ id: `th${Date.now()}_${i}`, nombre, tipo: 'adicional' }))

    const existingTarjeta = id ? allTarjetas.find((t) => t.id === id) : null
    const existingAdicionales = existingTarjeta?.tarjetahabientes?.filter((th) => th.tipo === 'titular') || []

    const tarjetahabientes = [
      ...existingAdicionales,
      ...adicionales,
    ]

    const payload = {
      nombre: document.getElementById('tarjeta-nombre').value.trim(),
      banco: document.getElementById('tarjeta-banco').value.trim(),
      ultimos4: document.getElementById('tarjeta-ultimos4').value.trim(),
      limite: parseFloat(document.getElementById('tarjeta-limite').value) || null,
      dia_corte: parseInt(document.getElementById('tarjeta-dia-corte').value) || null,
      dia_pago: parseInt(document.getElementById('tarjeta-dia-pago').value) || null,
      moneda: document.getElementById('tarjeta-moneda').value,
      tarjetahabientes,
    }

    try {
      if (id) {
        await fetch(`/api/credits/tarjetas/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/credits/tarjetas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      }
      closeTarjetaModal()
      loadCreditsData()
    } catch (err) {
      console.error('Error guardando tarjeta:', err)
    }
  })

  // Crédito form submit
  document.getElementById('credito-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = document.getElementById('credito-id').value

    document.getElementById('credito-mensualidad').removeAttribute('data-manual')

    const payload = {
      concepto: document.getElementById('credito-concepto').value.trim(),
      tarjeta_id: document.getElementById('credito-tarjeta').value || null,
      categoria: document.getElementById('credito-categoria').value,
      total: parseFloat(document.getElementById('credito-total').value) || null,
      meses_totales: parseInt(document.getElementById('credito-meses').value) || null,
      mensualidad: parseFloat(document.getElementById('credito-mensualidad').value) || null,
      fecha_inicio: document.getElementById('credito-fecha-inicio').value || null,
      meses_pagados: parseInt(document.getElementById('credito-meses-pagados').value) || 0,
    }

    try {
      if (id) {
        await fetch(`/api/credits/creditos/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/credits/creditos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      }
      closeCreditoModal()
      loadCreditsData()
    } catch (err) {
      console.error('Error guardando crédito:', err)
    }
  })

}
