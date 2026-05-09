import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import { JSONFilePreset } from 'lowdb/node'
import { nanoid } from 'nanoid'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'expenses.json')

const defaultData = { expenses: [] }
let db

export async function initStorage() {
  db = await JSONFilePreset(dbPath, defaultData)
  return db
}

export async function addExpense(data) {
  const expense = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    ...data,
  }
  db.data.expenses.unshift(expense)
  await db.write()
  return expense
}

function filterByMes(expenses, mes) {
  if (!mes) return expenses
  return expenses.filter((e) => {
    const d = e.fecha ? e.fecha.slice(0, 7) : e.timestamp?.slice(0, 7)
    return d === mes
  })
}

export function getAll({ mes, page = 1, limit = 15 } = {}) {
  const list = filterByMes(db.data.expenses, mes)
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(Math.max(1, page), pages)
  return {
    expenses: list.slice((safePage - 1) * limit, safePage * limit),
    total,
    page: safePage,
    pages,
  }
}

export async function updateExpense(id, patch) {
  const idx = db.data.expenses.findIndex((e) => e.id === id)
  if (idx === -1) return null
  db.data.expenses[idx] = { ...db.data.expenses[idx], ...patch }
  await db.write()
  return db.data.expenses[idx]
}

export async function deleteExpense(id) {
  const before = db.data.expenses.length
  db.data.expenses = db.data.expenses.filter((e) => e.id !== id)
  if (db.data.expenses.length === before) return false
  await db.write()
  return true
}

export function getStats(mes) {
  const expenses = filterByMes(db.data.expenses, mes)

  const totalGeneral = expenses.reduce((sum, e) => sum + (e.total || 0), 0)

  const byCategory = {}
  for (const e of expenses) {
    const cat = e.categoria || 'Sin categoria'
    byCategory[cat] = (byCategory[cat] || 0) + (e.total || 0)
  }

  const categories = Object.entries(byCategory)
    .map(([nombre, total]) => ({ nombre, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)

  const monedas = [...new Set(expenses.map((e) => e.moneda).filter(Boolean))]
  const moneda = monedas[0] || 'MXN'

  return {
    totalMes: Math.round(totalGeneral * 100) / 100,
    totalRegistros: expenses.length,
    categories,
    mes: mes || 'acumulado',
    moneda,
  }
}
