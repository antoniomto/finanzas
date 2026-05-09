/* ─── UTILS ─── */

const CATEGORY_CLASSES = {
  'Supermercado': 'badge-supermercado',
  'Restaurante':  'badge-restaurante',
  'Transporte':   'badge-transporte',
  'Farmacia':     'badge-farmacia',
}

function badgeClass(cat) {
  return CATEGORY_CLASSES[cat] || 'badge-default'
}

const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£' }

function formatCurrency(value, moneda = 'MXN') {
  if (value == null) return '—'
  const formatted = Number(value).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const sym = CURRENCY_SYMBOLS[moneda]
  return sym ? `${formatted} ${sym}` : `${formatted} ${moneda}`
}

function formatDate(isoDate) {
  if (!isoDate) return '—'
  const [y, m, d] = isoDate.split('-')
  if (!y || !m || !d) return isoDate
  return `${d}/${m}/${y}`
}

function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatMesLabel(mes) {
  if (!mes || mes === 'acumulado') return 'Total acumulado'
  const [y, m] = mes.split('-')
  const date = new Date(Number(y), Number(m) - 1, 1)
  const label = date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/* ─── STATE ─── */

let currentMes  = new Date().toISOString().slice(0, 7)
let currentPage = 1
const PAGE_SIZE = 15
const TODAY_MES = new Date().toISOString().slice(0, 7)

/* ─── RENDER EXPENSE ROW ─── */

function buildRow(expense, animate = false) {
  const tr = document.createElement('tr')
  if (animate) tr.classList.add('row-new')

  const fecha = expense.fecha ? formatDate(expense.fecha) : formatTimestamp(expense.timestamp)
  const cat = expense.categoria || 'Otros'
  const itemCount = Array.isArray(expense.items) ? expense.items.length : 0
  const moneda = expense.moneda || 'MXN'

  const thumbHtml = expense.imagenUrl
    ? `<img src="${expense.imagenUrl}" class="ticket-thumb" alt="ticket" title="Ver ticket" onclick="window.open('${expense.imagenUrl}','_blank')">`
    : '<span style="color:var(--text-tertiary);font-size:0.75rem">—</span>'

  const expJson = JSON.stringify(expense).replace(/'/g, '&#39;')

  tr.innerHTML = `
    <td style="width:52px;text-align:center">${thumbHtml}</td>
    <td class="td-comercio">${expense.comercio || '—'}</td>
    <td class="td-fecha">${fecha}</td>
    <td class="td-categoria">
      <span class="badge ${badgeClass(cat)}">${cat}</span>
    </td>
    <td class="td-items" style="color:var(--text-secondary);font-size:0.8125rem">
      ${itemCount > 0 ? `${itemCount} producto${itemCount !== 1 ? 's' : ''}` : '—'}
    </td>
    <td class="td-total">${formatCurrency(expense.total, moneda)}</td>
    <td class="td-actions">
      <button class="action-btn edit-btn" title="Editar" onclick='openEditModal(${expJson})'><i class="ph-bold ph-pencil-simple"></i></button>
      <button class="action-btn delete-btn" title="Eliminar" onclick="confirmDelete('${expense.id}', this)"><i class="ph-bold ph-trash"></i></button>
    </td>
  `
  tr.dataset.id = expense.id
  return tr
}

/* ─── STATS UPDATE ─── */

function updateStats(stats) {
  const totalEl = document.getElementById('total-mes')
  const metaEl  = document.getElementById('total-meta')
  const countEl = document.getElementById('table-count')
  const labelEl = document.getElementById('total-label')

  if (totalEl) totalEl.textContent = formatCurrency(stats.totalMes, stats.moneda)
  if (labelEl) labelEl.textContent = stats.mes === 'acumulado' ? 'TOTAL ACUMULADO' : 'TOTAL DEL MES'
  if (metaEl)  metaEl.textContent  = formatMesLabel(stats.mes)
  if (countEl) countEl.textContent = `${stats.totalRegistros} registro${stats.totalRegistros !== 1 ? 's' : ''}`

  renderCategories(stats.categories || [], stats.moneda)
}

function renderCategories(categories, moneda = 'MXN') {
  const container = document.getElementById('categories-list')
  if (!container) return

  if (categories.length === 0) {
    container.innerHTML = '<div class="categories-empty">Sin datos este mes</div>'
    return
  }

  const max = categories[0]?.total || 1
  container.innerHTML = categories.map((c) => {
    const pct = Math.round((c.total / max) * 100)
    return `
      <div class="category-row">
        <div class="category-row-header">
          <span class="category-name">${c.nombre}</span>
          <span class="category-amount">${formatCurrency(c.total, moneda)}</span>
        </div>
        <div class="category-bar-track">
          <div class="category-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `
  }).join('')
}

/* ─── TABLE MANAGEMENT ─── */

function clearEmptyRow() {
  const tbody = document.getElementById('expenses-tbody')
  if (!tbody) return
  const empty = tbody.querySelector('td[colspan]')
  if (empty) empty.closest('tr').remove()
}

function setTableEmpty() {
  const tbody = document.getElementById('expenses-tbody')
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Sin gastos registrados este mes</td></tr>`
}

function loadExpensesIntoTable(expenses) {
  const tbody = document.getElementById('expenses-tbody')
  if (!tbody) return
  if (!expenses.length) { setTableEmpty(); return }
  tbody.innerHTML = ''
  expenses.forEach((e) => tbody.appendChild(buildRow(e, false)))
}

function refreshRow(expense) {
  const existing = document.querySelector(`tr[data-id="${expense.id}"]`)
  if (!existing) return
  existing.replaceWith(buildRow(expense, false))
}

function removeRow(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`)
  if (!row) return
  row.classList.add('row-removing')
  row.addEventListener('animationend', () => row.remove(), { once: true })
}

/* ─── MONTH NAV ─── */

function renderMonthNav() {
  const label = document.getElementById('month-label')
  const nextBtn = document.getElementById('next-month')
  if (label) label.textContent = formatMesLabel(currentMes)
  if (nextBtn) nextBtn.disabled = currentMes >= TODAY_MES
}

function shiftMonth(delta) {
  const [y, m] = currentMes.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  currentMes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  currentPage = 1
  loadData()
}

/* ─── PAGINATION ─── */

function renderPagination(page, pages) {
  const container = document.getElementById('pagination')
  if (!container) return

  if (pages <= 1) { container.innerHTML = ''; return }

  const items = []

  items.push(`<button class="page-btn" ${page === 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})"><i class="ph-bold ph-caret-left"></i></button>`)

  const range = buildPageRange(page, pages)
  for (const p of range) {
    if (p === '…') {
      items.push(`<span class="page-ellipsis">…</span>`)
    } else {
      items.push(`<button class="page-btn ${p === page ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`)
    }
  }

  items.push(`<button class="page-btn" ${page === pages ? 'disabled' : ''} onclick="goToPage(${page + 1})"><i class="ph-bold ph-caret-right"></i></button>`)

  container.innerHTML = items.join('')
}

function buildPageRange(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const result = []
  result.push(1)
  if (page > 3) result.push('…')
  for (let p = Math.max(2, page - 1); p <= Math.min(pages - 1, page + 1); p++) result.push(p)
  if (page < pages - 2) result.push('…')
  result.push(pages)
  return result
}

function goToPage(page) {
  currentPage = page
  loadData()
}

/* ─── DATA LOADING ─── */

async function loadData() {
  renderMonthNav()
  try {
    const [expRes, statsRes] = await Promise.all([
      fetch(`/api/expenses?mes=${currentMes}&page=${currentPage}&limit=${PAGE_SIZE}`),
      fetch(`/api/stats?mes=${currentMes}`),
    ])
    const { expenses, page, pages } = await expRes.json()
    const stats = await statsRes.json()

    loadExpensesIntoTable(expenses)
    renderPagination(page, pages)
    updateStats(stats)
  } catch (err) {
    console.error('Error cargando datos:', err)
  }
}

/* ─── QR MODAL ─── */

let qrInstance = null

function openQRModal() {
  const modal = document.getElementById('qr-modal')
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
}

function closeQRModal() {
  const modal = document.getElementById('qr-modal')
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

function onBadgeClick() {
  const badge = document.getElementById('wa-badge')
  if (badge.classList.contains('connected')) return
  openQRModal()
}

function renderQR(qrString) {
  const wrapper = document.getElementById('qr-canvas-wrapper')
  if (!wrapper) return
  wrapper.innerHTML = ''
  if (qrInstance) { qrInstance.clear(); qrInstance = null }
  const div = document.createElement('div')
  wrapper.appendChild(div)
  qrInstance = new QRCode(div, {
    text: qrString,
    width: 200,
    height: 200,
    colorDark: '#111111',
    colorLight: '#FFFFFF',
    correctLevel: QRCode.CorrectLevel.M,
  })
}

/* ─── WA BADGE ─── */

const BADGE_LABELS = {
  disconnected: 'Sin conexión',
  connecting:   'Conectando',
  connected:    'Conectado',
}

function setWABadge(status) {
  const badge = document.getElementById('wa-badge')
  const text  = document.getElementById('wa-badge-text')
  if (!badge || !text) return
  badge.className = `wa-badge ${status}`
  text.textContent = BADGE_LABELS[status] || status
}

/* ─── EDIT MODAL ─── */

function openEditModal(expense) {
  document.getElementById('edit-id').value        = expense.id
  document.getElementById('edit-comercio').value  = expense.comercio || ''
  document.getElementById('edit-fecha').value     = expense.fecha || ''
  document.getElementById('edit-categoria').value = expense.categoria || 'Otros'
  document.getElementById('edit-total').value     = expense.total ?? ''
  document.getElementById('edit-moneda').value    = expense.moneda || 'MXN'

  const modal = document.getElementById('edit-modal')
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
  document.getElementById('edit-comercio').focus()
}

function closeModal() {
  const modal = document.getElementById('edit-modal')
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
}

async function confirmDelete(id, btn) {
  btn.closest('tr').classList.add('row-deleting')
  const ok = confirm('¿Eliminar este gasto? Esta acción no se puede deshacer.')
  if (!ok) { btn.closest('tr').classList.remove('row-deleting'); return }
  try {
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
  } catch (err) {
    console.error('Error al eliminar:', err)
    btn.closest('tr').classList.remove('row-deleting')
  }
}

/* ─── SCROLL ANIMATIONS ─── */

function initScrollAnimations() {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target) }
    }),
    { threshold: 0.1 }
  )
  document.querySelectorAll('.fade-in').forEach((el, i) => {
    el.style.transitionDelay = el.style.getPropertyValue('--delay') || `${i * 80}ms`
    observer.observe(el)
  })
}

/* ─── TAB SWITCHING ─── */

function switchTab(tab) {
  document.getElementById('tab-gastos').hidden = tab !== 'gastos'
  document.getElementById('tab-creditos').hidden = tab !== 'creditos'
  document.getElementById('tab-reporte').hidden = tab !== 'reporte'
  document.getElementById('tab-btn-gastos').classList.toggle('active', tab === 'gastos')
  document.getElementById('tab-btn-creditos').classList.toggle('active', tab === 'creditos')
  document.getElementById('tab-btn-reporte').classList.toggle('active', tab === 'reporte')

  if (tab === 'creditos' && typeof loadCreditsData === 'function') {
    loadCreditsData()
  }
  if (tab === 'reporte' && typeof loadReporteData === 'function') {
    loadReporteData()
  }
}

/* ─── INIT ─── */

document.addEventListener('DOMContentLoaded', async () => {
  initScrollAnimations()

  // Month nav buttons
  document.getElementById('prev-month').addEventListener('click', () => shiftMonth(-1))
  document.getElementById('next-month').addEventListener('click', () => shiftMonth(1))

  // Modal backdrops
  document.getElementById('qr-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeQRModal() })
  document.getElementById('edit-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal() })

  // Escape key
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeQRModal(); if (typeof closeCardDrawer === 'function') closeCardDrawer() } })

  // Edit form submit
  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = document.getElementById('edit-id').value
    const patch = {
      comercio:  document.getElementById('edit-comercio').value.trim(),
      fecha:     document.getElementById('edit-fecha').value,
      categoria: document.getElementById('edit-categoria').value,
      total:     parseFloat(document.getElementById('edit-total').value),
      moneda:    document.getElementById('edit-moneda').value,
    }
    try {
      await fetch(`/api/expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      closeModal()
    } catch (err) {
      console.error('Error al guardar:', err)
    }
  })

  await loadData()

  if (typeof initCredits === 'function') initCredits()

  const socket = io()
  window._socket = socket

  socket.on('connect', () => setWABadge('connecting'))

  socket.on('qr', (qrString) => {
    setWABadge('disconnected')
    renderQR(qrString)
    openQRModal()
  })

  socket.on('wa-status', (status) => {
    setWABadge(status)
    if (status === 'connected') closeQRModal()
  })

  socket.on('new-expense', async (expense) => {
    const expMes = expense.fecha ? expense.fecha.slice(0, 7) : expense.timestamp?.slice(0, 7)
    if (expMes === currentMes && currentPage === 1) {
      clearEmptyRow()
      const tbody = document.getElementById('expenses-tbody')
      tbody.prepend(buildRow(expense, true))
    }
    const stats = await fetch(`/api/stats?mes=${currentMes}`).then((r) => r.json()).catch(() => null)
    if (stats) updateStats(stats)
  })

  socket.on('expense-updated', async (expense) => {
    refreshRow(expense)
    const stats = await fetch(`/api/stats?mes=${currentMes}`).then((r) => r.json()).catch(() => null)
    if (stats) updateStats(stats)
  })

  socket.on('expense-deleted', async (id) => {
    removeRow(id)
    const stats = await fetch(`/api/stats?mes=${currentMes}`).then((r) => r.json()).catch(() => null)
    if (stats) updateStats(stats)
  })

  socket.on('estado-updated', ({ tarjeta_id }) => {
    if (typeof refreshTarjetaCard === 'function') refreshTarjetaCard(tarjeta_id)
  })

  socket.on('credito-added', () => {
    if (typeof loadCreditsData === 'function') loadCreditsData()
  })
})
