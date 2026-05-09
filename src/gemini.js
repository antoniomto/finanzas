import { GoogleGenerativeAI } from '@google/generative-ai'

const SYSTEM_PROMPT = `Eres un asistente de extracción de datos de tickets de compra.
Analiza la imagen del ticket y devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta:
{
  "comercio": "nombre del comercio o tienda",
  "fecha": "YYYY-MM-DD o null si no se puede leer",
  "total": número con decimales (ej: 2463.03) o null,
  "categoria": "categoría del gasto",
  "items": [{ "nombre": "nombre del producto", "precio": número }],
  "moneda": "código ISO de la moneda detectada en el ticket (ej: MXN, USD, EUR, COP, ARS)"
}

Categorías válidas: Supermercado, Restaurante, Transporte, Farmacia, Ropa, Electrónica, Hogar, Entretenimiento, Salud, Combustible, Otros.

Reglas:
- Si no puedes leer un campo con certeza, usa null. NUNCA inventes datos.
- El total debe ser el importe final pagado (con impuestos incluidos).
- La fecha debe estar en formato YYYY-MM-DD.
- La moneda la detectas del símbolo o contexto del ticket ($, €, MXN, USD, etc). Si ves $ en México, es MXN.
- Devuelve SOLO el JSON, sin explicaciones, sin markdown, sin backticks.`

const PDF_PROMPT = `Eres un experto extractor de estados de cuenta bancarios mexicanos. Analizas PDFs de AMEX, BBVA y Liverpool y produces un JSON estructurado y preciso.

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "banco": "American Express | BBVA | Liverpool",
  "nombre_tarjeta": "nombre completo de la tarjeta (ej: Tarjeta Oro BBVA, Gold Card, etc.)",
  "ultimos4": "últimos 4 dígitos de la tarjeta principal",
  "titular": "nombre completo del titular principal",
  "periodo": {
    "inicio": "YYYY-MM-DD",
    "fin": "YYYY-MM-DD",
    "dias": número entero
  },
  "fechas": {
    "corte": "YYYY-MM-DD",
    "limite_pago": "YYYY-MM-DD",
    "siguiente_corte": "YYYY-MM-DD o null si no aparece explícitamente"
  },
  "limite_credito": número o null,
  "credito_disponible": número o null,
  "resumen": {
    "saldo_anterior": número o null,
    "cargos_regulares": número o null,
    "cargos_msi_capital": número o null,
    "intereses": número o null,
    "comisiones": número o null,
    "iva": número o null,
    "pagos_y_abonos": número o null
  },
  "pagos_requeridos": {
    "para_no_generar_intereses": número o null,
    "pago_minimo_mas_meses": número o null,
    "pago_minimo": número o null
  },
  "moneda": "MXN",
  "por_persona": [
    { "nombre": "nombre completo", "tipo": "titular | adicional", "total": número, "es_credito_neto": boolean }
  ],
  "pagos_recibidos": [
    { "fecha": "YYYY-MM-DD", "descripcion": "descripción del pago", "monto": número }
  ],
  "creditos_msi": [
    {
      "concepto": "descripción del comercio o plan",
      "fecha_inicio": "YYYY-MM-DD o null",
      "monto_original": número o null,
      "saldo_pendiente": número o null,
      "pago_requerido": número o null,
      "interes_periodo": número o 0,
      "numero_mensualidad": número entero (pago actual, ej: 8 de 20),
      "meses_totales": número entero,
      "tasa": número (0 si sin intereses),
      "con_intereses": boolean
    }
  ]
}

═══════════════════════════════════════════════════
REGLAS ESPECÍFICAS POR BANCO
═══════════════════════════════════════════════════

AMERICAN EXPRESS:
- por_persona: AMEX desgrana los cargos de cada persona en DOS secciones separadas que DEBES sumar:
  1. "Total de las transacciones en $ de [NOMBRE]" → cargos en MXN
  2. "Total de Transacciones en Moneda Extranjera de [NOMBRE]" → cargos en USD/otra moneda ya convertidos a MXN
  El campo "total" de cada persona = suma de (1) + (2). Si alguno no existe, suma solo el que haya.
  SIEMPRE incluye al titular aunque su total sea negativo (CR).
- Cuando el total de una persona dice "CR" o es negativo (porque AMEX difiere cargos MSI automáticamente), usa el valor ABSOLUTO como total y marca es_credito_neto: true.
- pagos_recibidos: busca líneas con "GRACIAS POR SU PAGO" o similares en la lista de movimientos; son los créditos que representan pagos del cliente.
- creditos_msi: busca sección "Resumen de Meses sin Intereses" o tabla MSI. Todas las filas son con_intereses: false (AMEX es siempre 0%).
- numero_mensualidad: el campo "Pago X/Y" → X es el número actual. meses_totales: el Y.
- pagos_requeridos.para_no_generar_intereses: busca "Pago para no generar intereses" o "Total a pagar".
- resumen.cargos_msi_capital: el importe total de "MONTO A DIFERIR MESES EN AUTOMÁTICO" si aparece.

BBVA:
- por_persona: BBVA NO desglosa por tarjetahabiente. Devuelve por_persona: [].
- creditos_msi: BBVA tiene DOS tablas separadas: "Meses Sin Intereses" y "Créditos con Interés" (o "Efectivo Inmediato"). Extrae ambas.
  - Para MSI sin intereses: con_intereses: false, tasa: 0.
  - Para créditos con intereses (Efectivo Inmediato, etc.): con_intereses: true, extrae la tasa (ej: 36).
  - pago_requerido en BBVA incluye capital + interés del periodo. interes_periodo: extraer el campo "Interés del periodo" o "Intereses" de la fila.
  - numero_mensualidad: campo "Núm. de pago" o "Pago X de Y" → X. meses_totales: Y.
- pagos_recibidos: en BBVA aparecen inline en los movimientos regulares, busca "SU PAGO POR DOMICILIACION", "BMOVIL.PAGO TDC", "PAGO TDC", "TRANSFERENCIA PAGO" y similares con montos negativos o en columna de créditos.
- resumen: busca el cuadro "Resumen de tu cuenta" con adeudo anterior, cargos, intereses, comisiones, IVA, pagos.
- pagos_requeridos: BBVA muestra tres opciones: pago total (para no generar intereses), pago para no caer en mora (pago mínimo + meses), y pago mínimo.
- limite_credito y credito_disponible: extraer del resumen de cuenta.

LIVERPOOL:
- por_persona: Liverpool SÍ tiene "DETALLE DE MOVIMIENTOS TARJETAS ADICIONALES". Incluye adicionales con sus totales. El titular puede no tener sección separada; si no hay desglose del titular, devuelve solo los adicionales identificados.
- creditos_msi: busca "RESUMEN DE PLANES" con tablas "CON INTERESES" y "SIN INTERESES".
  - numero_mensualidad: columna "Mensualidad a pagar" = número del pago actual (ej: 18 significa es el pago 18).
  - meses_totales: extraer del nombre del plan, ej: "20 MENS S/INTERESES" → 20, "09 MENS S/INTERESES" → 9.
  - concepto: usa el nombre del comercio del movimiento si está disponible, si no usa el nombre del plan de financiamiento.
  - monto_original: columna "Saldo Anterior" de esa fila en la tabla de planes (es el monto al inicio del plan).
  - saldo_pendiente: columna "Saldo al Corte".
  - pago_requerido: columna "Pago para no generar intereses" o "Mensualidad".
- pagos_recibidos: busca "SU PAGO SPEI", "PAGO EN TIENDA", "PAGO TRANSFERENCIA" y similares.
- Liverpool puede tener monedero de puntos; ignorarlo (no es saldo monetario real).

═══════════════════════════════════════════════════
REGLAS GENERALES
═══════════════════════════════════════════════════
- Si un campo no aparece en el documento, usa null. NUNCA inventes datos.
- pagos_recibidos: SOLO incluye pagos reales del cliente (créditos/abonos que son pagos). NO incluyas los cargos MSI diferidos (que aparecen como CR por AMEX pero son diferimientos, no pagos).
- siguiente_corte: solo si aparece explícitamente como "Siguiente fecha de corte" o similar. Si no aparece, null.
- Todos los montos son positivos (usa valor absoluto). Solo es_credito_neto puede indicar balance favorable.
- Devuelve SOLO el JSON, sin explicaciones, sin markdown, sin backticks.`

let genAI

function getClient() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return genAI
}

export async function parseTicket(imageBuffer, mimeType = 'image/jpeg') {
  const model = getClient().getGenerativeModel({ model: 'gemini-2.5-flash' })

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType,
    },
  }

  const result = await model.generateContent([SYSTEM_PROMPT, imagePart])
  const text = result.response.text().trim()

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const data = JSON.parse(cleaned)

  if (typeof data !== 'object' || data === null) {
    throw new Error('Gemini no devolvió un objeto válido')
  }

  return data
}

export async function parseEstadoCuenta(pdfBuffer) {
  const model = getClient().getGenerativeModel({ model: 'gemini-2.5-flash' })

  const pdfPart = {
    inlineData: {
      data: pdfBuffer.toString('base64'),
      mimeType: 'application/pdf',
    },
  }

  const result = await model.generateContent([PDF_PROMPT, pdfPart])
  const text = result.response.text().trim()
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const data = JSON.parse(cleaned)

  if (typeof data !== 'object' || data === null) {
    throw new Error('Gemini no devolvió un objeto válido para el estado de cuenta')
  }

  return data
}
