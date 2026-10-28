type DemoRow = Record<string, unknown>
type DemoTables = Record<string, DemoRow[]>
type DemoState = { tables: DemoTables; nextSaleNumber: number }
type DemoProduct = DemoRow & {
  id: string
  category_id: string
  code: string
  name: string
  cost: number
  price: number
  current_stock: number
  promotion: { qtd: number; preco: number } | null
}

export const DEMO_COMPANY_ID = '00000000-0000-4000-8000-000000000001'
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002'
export const DEMO_COMPANY = {
  id: DEMO_COMPANY_ID,
  legal_name: 'Empresa Demo Ltda.',
  trade_name: 'Nexora Store Demo',
  cnpj: '12345678000195',
}

// Demo records use a versioned browser key and never enter the production Supabase project.
const STORAGE_KEY = 'nexora-crm-demo-v1'
const isoNow = () => new Date().toISOString()
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const categoryNames = ['Camisetas', 'Calças e bermudas', 'Calçados', 'Acessórios', 'Bolsas', 'Perfumes', 'Outlet']
const productNames = [
  ['Camiseta essencial', 79.9, 28], ['Camiseta algodão premium', 119.9, 22], ['Camiseta oversized areia', 139.9, 18],
  ['Camiseta estampada urbana', 99.9, 31], ['Polo clássica', 149.9, 16], ['Regata esportiva', 69.9, 24],
  ['Calça jeans reta', 229.9, 15], ['Calça cargo verde', 249.9, 12], ['Calça jogger preta', 179.9, 20],
  ['Bermuda chino', 139.9, 27], ['Bermuda jeans', 159.9, 19], ['Short esportivo', 89.9, 34],
  ['Tênis casual branco', 349.9, 14], ['Tênis corrida leve', 429.9, 11], ['Sandália confortável', 129.9, 21],
  ['Bota urbana', 489.9, 8], ['Boné aba curva', 89.9, 29], ['Cinto couro legítimo', 119.9, 17],
  ['Carteira compacta', 79.9, 25], ['Meias cano médio (3 pares)', 49.9, 42], ['Mochila commuter', 279.9, 13],
  ['Bolsa transversal', 189.9, 16], ['Óculos solar clássico', 199.9, 12], ['Relógio minimalista', 319.9, 9],
  ['Perfume amadeirado 100ml', 289.9, 10], ['Body splash cítrico', 89.9, 23], ['Kit cuidados pessoais', 149.9, 14],
  ['Camiseta básica — promoção 2x', 59.9, 36], ['Jaqueta corta-vento', 299.9, 9], ['Moletom com capuz', 219.9, 17],
  ['Camisa social slim', 199.9, 13], ['Bermuda linho', 189.9, 15], ['Chinelo anatômico', 79.9, 30],
  ['Necessaire viagem', 69.9, 20], ['Colar aço inox', 99.9, 18], ['Carteira presenteável', 109.9, 11],
] as const
const firstNames = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olivia', 'Pedro', 'Rafaela', 'Samuel', 'Tainá', 'Vitor', 'Yasmin', 'André', 'Beatriz', 'Caio', 'Débora', 'Enzo', 'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Júlia', 'Leonardo', 'Manuela', 'Otávio', 'Paula', 'Renato']
const surnames = ['Almeida', 'Barbosa', 'Carvalho', 'Dias', 'Ferreira', 'Gomes', 'Lima', 'Martins', 'Mendes', 'Oliveira', 'Pereira', 'Ribeiro', 'Rocha', 'Santos', 'Souza', 'Teixeira']
const neighborhoods = ['Centro', 'Jardim América', 'Vila Nova', 'Boa Vista', 'Santa Clara', 'Jardim Europa']
const paymentMethods = ['pix', 'credit', 'debit', 'cash'] as const

function daysAgo(days: number, hour = 12): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function createSeed(): DemoState {
  const now = isoNow()
  const tables: DemoTables = {
    companies: [{ ...DEMO_COMPANY, created_by: DEMO_USER_ID, created_at: now, updated_at: now }],
    company_members: [{ company_id: DEMO_COMPANY_ID, user_id: DEMO_USER_ID, role: 'owner', status: 'active', created_at: now }],
    profiles: [{ id: DEMO_USER_ID, full_name: 'Operador da Demo', created_at: now }],
    product_categories: categoryNames.map((name, index) => ({
      id: id(100 + index), company_id: DEMO_COMPANY_ID, name, active: true, sort_order: index + 1, created_at: now,
    })),
    products: [],
    stock_movements: [],
    customers: [],
    customer_notes: [],
    customer_procurations: [],
    customer_contacts: [],
    customer_settings: [{
      company_id: DEMO_COMPANY_ID,
      inactive_days: 60,
      whatsapp_message: 'Olá {primeiro_nome}! Aqui é da {loja}. Chegaram novidades que têm a sua cara. Passa aqui pra conferir!',
      birthday_message: 'Feliz aniversário, {primeiro_nome}! A {loja} preparou um presente pra você.',
      procure_message: 'Olá {primeiro_nome}! Aqui é da {loja}. Chegou o que você procurava: {procura}.',
      created_at: now,
      updated_at: now,
    }],
    cash_registers: [],
    sales: [],
    sale_items: [],
    sale_payments: [],
  }

  const categories = tables.product_categories
  const products: DemoProduct[] = productNames.map(([name, price, stock], index) => ({
    id: id(200 + index),
    company_id: DEMO_COMPANY_ID,
    category_id: id(100 + Math.min(categoryNames.length - 1, Math.floor(index / 6))),
    code: `NX-${String(index + 1).padStart(4, '0')}`,
    name,
    cost: round(price * 0.48),
    price,
    current_stock: stock,
    stock_min: 5,
    stock_max: stock + 35,
    observations: index % 7 === 0 ? 'Produto em destaque na vitrine.' : '',
    promotion: index === 27 ? { qtd: 2, preco: 99.9 } : null,
    active: index !== 35,
    created_by: DEMO_USER_ID,
    created_at: daysAgo(220 - index),
    updated_at: now,
  }))
  tables.products = products

  const customers = firstNames.map((firstName, index) => {
    const fullName = `${firstName} ${surnames[index % surnames.length]}`
    const birth = new Date()
    if (index < 3) {
      birth.setDate(birth.getDate() + index * 2)
    } else {
      birth.setMonth((index * 2) % 12, (index * 3) % 27 + 1)
    }
    birth.setFullYear(birth.getFullYear() - 20 - index % 30)
    return {
      id: id(300 + index),
      company_id: DEMO_COMPANY_ID,
      full_name: fullName,
      cpf: String(100_000_000_00 + index * 1_003_007).padStart(11, '0'),
      phone: `119${String(80000000 + index * 137).padStart(8, '0')}`,
      birth_date: `${birth.getFullYear() - 20 - index % 30}-${String(birth.getMonth() + 1).padStart(2, '0')}-${String(birth.getDate()).padStart(2, '0')}`,
      street: `Rua das Flores`,
      address_number: String(10 + index * 3),
      neighborhood: neighborhoods[index % neighborhoods.length],
      city: index % 5 === 0 ? 'São Bernardo do Campo' : 'São Paulo',
      observations: index % 9 === 0 ? 'Prefere receber novidades pelo WhatsApp.' : '',
      custom_fields: {},
      last_contact_at: index % 3 === 0 ? daysAgo(index * 2 + 1) : null,
      archived_at: index === 34 ? daysAgo(28) : null,
      created_by: DEMO_USER_ID,
      created_at: daysAgo(240 - index * 4),
      updated_at: now,
    }
  })
  tables.customers = customers

  const registers = Array.from({ length: 7 }, (_value, index) => ({
    id: id(400 + index),
    company_id: DEMO_COMPANY_ID,
    status: index === 6 ? 'open' : 'closed',
    opening_cash: 250 + index * 50,
    opened_at: daysAgo((6 - index) * 24, 9),
    opened_by: DEMO_USER_ID,
    operator_name: index % 2 ? 'Marina Costa' : 'Rafael Lima',
    closed_at: index === 6 ? null : daysAgo((6 - index) * 24, 19),
    closed_by: index === 6 ? null : DEMO_USER_ID,
    expected_cash: index === 6 ? null : 900 + index * 135,
    counted_cash: index === 6 ? null : 890 + index * 138,
    difference: index === 6 ? null : -10 + index * 3,
    closing_note: index === 6 ? '' : 'Conferência concluída.',
    created_at: daysAgo((6 - index) * 24, 9),
  }))
  tables.cash_registers = registers

  const initialMovements: DemoRow[] = products.map((product, index) => ({
    id: id(500 + index),
    company_id: DEMO_COMPANY_ID,
    product_id: product.id,
    type: 'Estoque inicial',
    direction: 1,
    quantity: product.current_stock,
    unit_cost: product.cost,
    occurred_at: daysAgo(210 - index),
    observations: 'Saldo inicial para demonstração.',
    origin: 'initial',
    reference_id: null,
    created_by: DEMO_USER_ID,
    created_at: daysAgo(210 - index),
  }))
  tables.stock_movements = initialMovements

  const sales: DemoRow[] = []
  const saleItems: DemoRow[] = []
  const salePayments: DemoRow[] = []
  for (let index = 0; index < 96; index += 1) {
    const saleId = id(1000 + index)
    const days = Math.max(0, 178 - index * 1.85)
    const customer = index % 11 === 0 ? null : customers[(index * 7) % customers.length]
    const firstProduct = products[(index * 5 + 2) % products.length]
    const secondProduct = index % 3 === 0 ? products[(index * 11 + 9) % products.length] : null
    const chosen = secondProduct && secondProduct.id !== firstProduct.id ? [firstProduct, secondProduct] : [firstProduct]
    const details = chosen.map((product, position) => {
      const quantity = index % 8 === 0 ? 2 : 1 + ((index + position) % 2)
      const subtotal = round(Number(product.price) * quantity)
      const discount = index % 9 === 0 ? round(subtotal * 0.05) : 0
      return {
        id: id(2000 + index * 2 + position),
        company_id: DEMO_COMPANY_ID,
        sale_id: saleId,
        product_id: product.id,
        product_name: product.name,
        product_code: product.code,
        category_name: categories.find((category) => category.id === product.category_id)?.name ?? '',
        quantity,
        unit_price: product.price,
        unit_cost: product.cost,
        promotion_quantity: product.promotion?.qtd ?? null,
        promotion_price: product.promotion?.preco ?? null,
        promotion_active: Boolean(product.promotion),
        promotion_discount: 0,
        discount_type: 'amount',
        discount_value: discount,
        discount_reason: discount ? 'Desconto de demonstração' : '',
        subtotal,
        item_discount: discount,
        total: round(subtotal - discount),
      }
    })
    const subtotal = round(details.reduce((sum, item) => sum + Number(item.subtotal), 0))
    const itemDiscount = round(details.reduce((sum, item) => sum + Number(item.item_discount), 0))
    const total = round(subtotal - itemDiscount)
    const status = index % 17 === 0 ? 'cancelled' : 'active'
    sales.push({
      id: saleId,
      company_id: DEMO_COMPANY_ID,
      sale_number: index + 1,
      cash_register_id: registers[Math.min(6, Math.floor(days / 24))].id,
      customer_id: customer?.id ?? null,
      seller_name: index % 2 ? 'Marina Costa' : 'Rafael Lima',
      status,
      sold_at: daysAgo(days, 10 + (index % 9)),
      subtotal,
      promotion_discount: 0,
      item_discount: itemDiscount,
      sale_discount: 0,
      total_discount: itemDiscount,
      total,
      received: total,
      change_due: 0,
      sale_discount_type: 'amount',
      sale_discount_value: 0,
      sale_discount_reason: '',
      observations: index % 6 === 0 ? 'Cliente retirou na loja.' : '',
      cancelled_at: status === 'cancelled' ? daysAgo(days - 1) : null,
      cancelled_by: status === 'cancelled' ? DEMO_USER_ID : null,
      cancellation_reason: status === 'cancelled' ? 'Troca solicitada pelo cliente.' : '',
      updated_at: now,
      created_by: DEMO_USER_ID,
      updated_by: DEMO_USER_ID,
    })
    saleItems.push(...details)
    const method = paymentMethods[index % paymentMethods.length]
    salePayments.push({
      id: id(4000 + index),
      company_id: DEMO_COMPANY_ID,
      sale_id: saleId,
      payment_method: method,
      payment_label: { pix: 'Pix', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro' }[method],
      amount: total,
    })
    if (status === 'active') {
      for (const item of details) {
        const product = products.find((candidate) => candidate.id === item.product_id)
        if (product) product.current_stock = Number(product.current_stock) - Number(item.quantity)
        tables.stock_movements.push({
          id: id(10_000 + index * 2 + details.indexOf(item)),
          company_id: DEMO_COMPANY_ID,
          product_id: item.product_id,
          type: 'Venda',
          direction: -1,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          occurred_at: daysAgo(days, 10 + (index % 9)),
          observations: `Venda #${index + 1}`,
          origin: 'sale',
          reference_id: saleId,
          created_by: DEMO_USER_ID,
          created_at: daysAgo(days),
        })
      }
    }
  }
  tables.sales = sales
  tables.sale_items = saleItems
  tables.sale_payments = salePayments

  const extraMovements = products.slice(0, 14).map((product, index) => ({
    id: id(600 + index),
    company_id: DEMO_COMPANY_ID,
    product_id: product.id,
    type: index % 2 ? 'Ajuste de entrada' : 'Chegada de estoque',
    direction: 1,
    quantity: 3 + index % 6,
    unit_cost: product.cost,
    occurred_at: daysAgo(40 + index * 3),
    observations: 'Reposição de mercadoria.',
    origin: 'manual',
    reference_id: null,
    created_by: DEMO_USER_ID,
    created_at: daysAgo(40 + index * 3),
  }))
  for (const movement of extraMovements) {
    const product = products.find((candidate) => candidate.id === movement.product_id)
    if (product) product.current_stock = Number(product.current_stock) + Number(movement.quantity)
  }
  tables.stock_movements.push(...extraMovements)

  tables.customer_notes = customers.slice(0, 18).map((customer, index) => ({
    id: id(700 + index),
    company_id: DEMO_COMPANY_ID,
    customer_id: customer.id,
    content: ['Cliente interessado na nova coleção.', 'Solicitou contato quando houver reposição.', 'Prefere atendimento no período da tarde.'][index % 3],
    attended_by: index % 2 ? 'Marina Costa' : 'Rafael Lima',
    created_by: DEMO_USER_ID,
    created_at: daysAgo(index * 4 + 1),
    updated_at: now,
  }))
  tables.customer_procurations = customers.slice(4, 22).map((customer, index) => ({
    id: id(800 + index),
    company_id: DEMO_COMPANY_ID,
    customer_id: customer.id,
    category_id: categories[index % categories.length].id,
    description: ['Tênis branco tamanho 38', 'Camiseta azul-marinho M', 'Bolsa transversal caramelo', 'Calça cargo tamanho 42'][index % 4],
    details: 'Avisar assim que chegar na loja.',
    status: index % 5 === 0 ? 'fulfilled' : index % 7 === 0 ? 'abandoned' : 'open',
    occurred_on: daysAgo(index * 5 + 1).slice(0, 10),
    resolved_at: index % 5 === 0 || index % 7 === 0 ? daysAgo(index * 2 + 1) : null,
    created_by: DEMO_USER_ID,
    created_at: daysAgo(index * 5 + 1),
    updated_at: now,
  }))
  tables.customer_contacts = customers.slice(0, 14).map((customer, index) => ({
    id: id(900 + index),
    company_id: DEMO_COMPANY_ID,
    customer_id: customer.id,
    channel: 'whatsapp',
    context: (['general', 'reactivation', 'procure', 'birthday'] as const)[index % 4],
    created_by: DEMO_USER_ID,
    contacted_at: daysAgo(index * 2 + 1),
  }))

  return { tables, nextSaleNumber: sales.length + 1 }
}

function readState(): DemoState {
  const serialized = localStorage.getItem(STORAGE_KEY)
  if (!serialized) {
    const state = createSeed()
    writeState(state)
    return state
  }

  const state: unknown = JSON.parse(serialized)
  if (
    !state
    || typeof state !== 'object'
    || !('tables' in state)
    || !state.tables
    || typeof state.tables !== 'object'
    || !Array.isArray((state.tables as DemoTables).products)
    || !Array.isArray((state.tables as DemoTables).sales)
    || !Array.isArray((state.tables as DemoTables).customers)
  ) {
    throw new Error('Os dados locais da demo estão inválidos. Use “Reiniciar demo” para restaurá-los.')
  }
  return state as DemoState
}

function writeState(state: DemoState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function resetDemoData(): void {
  writeState(createSeed())
}

function uuid(): string {
  return crypto.randomUUID()
}

function parseFilter(value: string): { operator: string; expected: string } {
  const separator = value.indexOf('.')
  return { operator: value.slice(0, separator), expected: value.slice(separator + 1) }
}

function matches(row: DemoRow, search: URLSearchParams): boolean {
  for (const [key, value] of search.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue
    const { operator, expected } = parseFilter(value)
    const current = row[key]
    if (operator === 'eq' && String(current) !== expected) return false
    if (operator === 'neq' && String(current) === expected) return false
    if (operator === 'is' && (expected === 'null' ? current != null : String(current) !== expected)) return false
    if (operator === 'not' && expected.startsWith('is.null') && current == null) return false
    if (operator === 'in') {
      const values = expected.replace(/^\(/, '').replace(/\)$/, '').split(',').map((item) => item.replace(/^"|"$/g, ''))
      if (!values.includes(String(current))) return false
    }
    if (operator === 'gte' && String(current) < expected) return false
    if (operator === 'lte' && String(current) > expected) return false
    if (operator === 'gt' && !(Number(current) > Number(expected))) return false
    if (operator === 'lt' && !(Number(current) < Number(expected))) return false
  }
  return true
}

function queryRows(rows: DemoRow[], search: URLSearchParams): DemoRow[] {
  let result = rows.filter((row) => matches(row, search))
  const ordering = search.get('order')
  if (ordering) {
    const clauses = ordering.split(',')
    result = [...result].sort((a, b) => {
      for (const clause of clauses) {
        const [column, direction] = clause.split('.')
        const left = a[column]
        const right = b[column]
        if (left === right) continue
        const comparison = left == null ? -1 : right == null ? 1 : String(left).localeCompare(String(right), 'pt-BR', { numeric: true })
        return direction === 'desc' ? -comparison : comparison
      }
      return 0
    })
  }
  const offset = Number(search.get('offset') ?? 0)
  const limit = Number(search.get('limit') ?? result.length)
  return result.slice(offset, offset + limit)
}

function projectRows(rows: DemoRow[], selection: string | null): DemoRow[] {
  if (!selection || selection === '*') return rows
  const columns = selection.split(',').map((column) => column.trim()).filter((column) => column && !column.includes('('))
  return rows.map((row) => Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]])))
}

function addMovement(state: DemoState, values: DemoRow): DemoRow {
  const product = state.tables.products.find((row) => row.id === values.product_id)
  if (!product) throw new Error('Produto não encontrado.')
  const direction = Number(values.direction)
  const quantity = Number(values.quantity)
  product.current_stock = Number(product.current_stock) + direction * quantity
  const movement = {
    id: uuid(),
    company_id: values.company_id,
    product_id: values.product_id,
    type: values.type,
    direction,
    quantity,
    unit_cost: values.unit_cost ?? null,
    occurred_at: values.occurred_at ?? isoNow(),
    observations: values.observations ?? '',
    origin: values.origin ?? 'manual',
    reference_id: values.reference_id ?? null,
    created_by: DEMO_USER_ID,
    created_at: isoNow(),
  }
  state.tables.stock_movements.push(movement)
  return movement
}

function handleRpc(name: string, args: DemoRow, state: DemoState): unknown {
  const { tables } = state
  if (name === 'open_cash_register') {
    if (tables.cash_registers.some((cash) => cash.status === 'open')) throw new Error('cash_register_already_open')
    const register = {
      id: uuid(), company_id: args.p_company_id, status: 'open', opening_cash: args.p_opening_cash,
      opened_at: isoNow(), opened_by: DEMO_USER_ID, operator_name: args.p_operator_name ?? 'Operador Demo',
      closed_at: null, closed_by: null, expected_cash: null, counted_cash: null, difference: null,
      closing_note: '', created_at: isoNow(),
    }
    tables.cash_registers.push(register)
    return register.id
  }

  if (name === 'close_cash_register') {
    const register = tables.cash_registers.find((row) => row.id === args.p_cash_register_id && row.company_id === args.p_company_id)
    if (!register) throw new Error('cash_register_not_found')
    const cashSales = tables.sales.filter((sale) => sale.cash_register_id === register.id && sale.status === 'active')
    const cashPayments = tables.sale_payments
      .filter((payment) => cashSales.some((sale) => sale.id === payment.sale_id) && payment.payment_method === 'cash')
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    const changeDue = cashSales.reduce((sum, sale) => sum + Number(sale.change_due), 0)
    const expected = round(Number(register.opening_cash) + cashPayments - changeDue)
    register.status = 'closed'
    register.closed_at = isoNow()
    register.closed_by = DEMO_USER_ID
    register.expected_cash = expected
    register.counted_cash = Number(args.p_counted_cash)
    register.difference = round(Number(args.p_counted_cash) - expected)
    register.closing_note = String(args.p_closing_note ?? '')
    return null
  }

  if (name === 'register_stock_movement') {
    if (!Number.isInteger(Number(args.p_quantity)) || Number(args.p_quantity) <= 0) throw new Error('invalid_quantity')
    return addMovement(state, {
      company_id: args.p_company_id,
      product_id: args.p_product_id,
      type: args.p_type,
      direction: args.p_direction,
      quantity: args.p_quantity,
      unit_cost: args.p_unit_cost,
      occurred_at: args.p_occurred_at,
      observations: args.p_observations,
      origin: args.p_origin ?? 'manual',
    }).id
  }

  if (name === 'update_stock_movement') {
    const movement = tables.stock_movements.find((row) => row.id === args.p_movement_id && row.company_id === args.p_company_id)
    if (!movement || movement.origin === 'sale') throw new Error('stock_movement_not_found_or_locked')
    const oldProduct = tables.products.find((row) => row.id === movement.product_id)
    if (oldProduct) oldProduct.current_stock = Number(oldProduct.current_stock) - Number(movement.direction) * Number(movement.quantity)
    const product = tables.products.find((row) => row.id === args.p_product_id)
    if (!product) throw new Error('product_not_found')
    product.current_stock = Number(product.current_stock) + Number(args.p_direction) * Number(args.p_quantity)
    Object.assign(movement, {
      product_id: args.p_product_id, type: args.p_type, direction: args.p_direction, quantity: args.p_quantity,
      unit_cost: args.p_unit_cost, occurred_at: args.p_occurred_at, observations: args.p_observations,
    })
    return null
  }

  if (name === 'delete_stock_movement') {
    const index = tables.stock_movements.findIndex((row) => row.id === args.p_movement_id && row.company_id === args.p_company_id)
    if (index < 0 || tables.stock_movements[index].origin === 'sale') throw new Error('stock_movement_not_found_or_locked')
    const [movement] = tables.stock_movements.splice(index, 1)
    const product = tables.products.find((row) => row.id === movement.product_id)
    if (product) product.current_stock = Number(product.current_stock) - Number(movement.direction) * Number(movement.quantity)
    return null
  }

  if (name === 'set_customer_archived') {
    const customer = tables.customers.find((row) => row.id === args.p_customer_id && row.company_id === args.p_company_id)
    if (!customer) throw new Error('customer_not_found')
    customer.archived_at = args.p_archived ? isoNow() : null
    customer.updated_at = isoNow()
    return null
  }

  if (name === 'record_customer_contact') {
    const customer = tables.customers.find((row) => row.id === args.p_customer_id && row.company_id === args.p_company_id)
    if (!customer) throw new Error('customer_not_found')
    const contactedAt = isoNow()
    customer.last_contact_at = contactedAt
    tables.customer_contacts.push({
      id: uuid(), company_id: args.p_company_id, customer_id: args.p_customer_id, channel: 'whatsapp',
      context: args.p_context ?? 'general', created_by: DEMO_USER_ID, contacted_at: contactedAt,
    })
    return null
  }

  if (name === 'save_sale') {
    const cash = tables.cash_registers.find((row) => row.id === args.p_cash_register_id && row.company_id === args.p_company_id)
    if (!cash) throw new Error('cash_register_not_found')
    const editing = args.p_sale_id
      ? tables.sales.find((row) => row.id === args.p_sale_id && row.company_id === args.p_company_id)
      : undefined
    if (args.p_sale_id && (!editing || editing.status !== 'active')) throw new Error('sale_not_found_or_inactive')
    const itemArgs = Array.isArray(args.p_items) ? args.p_items as DemoRow[] : []
    const paymentArgs = Array.isArray(args.p_payments) ? args.p_payments as DemoRow[] : []
    if (!itemArgs.length) throw new Error('sale_requires_items')

    if (editing) {
      for (const oldItem of tables.sale_items.filter((item) => item.sale_id === editing.id)) {
        const product = tables.products.find((row) => row.id === oldItem.product_id)
        if (product) product.current_stock = Number(product.current_stock) + Number(oldItem.quantity)
      }
      tables.stock_movements = tables.stock_movements.filter((movement) => (
        movement.origin !== 'sale' || movement.reference_id !== editing.id
      ))
    }

    const calculatedItems = itemArgs.map((item, index) => {
      const product = tables.products.find((row) => row.id === item.product_id && row.company_id === args.p_company_id)
      if (!product) throw new Error('product_not_found')
      const quantity = Number(item.quantity)
      const stockAfter = Number(product.current_stock) - quantity
      if (stockAfter < 0 && !args.p_allow_negative_stock) throw new Error('insufficient_stock')
      const unitPrice = Number(item.unit_price)
      const subtotal = round(quantity * unitPrice)
      const promotionQuantity = Number(item.promotion_quantity) || null
      const promotionPrice = item.promotion_price == null ? null : Number(item.promotion_price)
      const promotionDiscount = item.promotion_active && promotionQuantity && promotionPrice != null && quantity >= promotionQuantity
        ? round(Math.floor(quantity / promotionQuantity) * (promotionQuantity * unitPrice - promotionPrice))
        : 0
      const discountedBase = Math.max(0, subtotal - promotionDiscount)
      const requestedDiscount = item.discount_type === 'percent'
        ? round(discountedBase * Number(item.discount_value ?? 0) / 100)
        : round(Number(item.discount_value ?? 0))
      const itemDiscount = Math.min(discountedBase, requestedDiscount)
      product.current_stock = stockAfter
      return {
        id: uuid(), company_id: args.p_company_id, sale_id: editing?.id ?? '',
        product_id: product.id, product_name: product.name, product_code: product.code,
        category_name: tables.product_categories.find((category) => category.id === product.category_id)?.name ?? '',
        quantity, unit_price: unitPrice, unit_cost: product.cost, promotion_quantity: promotionQuantity,
        promotion_price: promotionPrice, promotion_active: Boolean(item.promotion_active),
        promotion_discount: promotionDiscount, discount_type: item.discount_type ?? 'amount',
        discount_value: Number(item.discount_value ?? 0), discount_reason: String(item.discount_reason ?? ''),
        subtotal, item_discount: itemDiscount, total: round(discountedBase - itemDiscount), itemIndex: index,
      }
    })
    const subtotal = round(calculatedItems.reduce((sum, item) => sum + Number(item.subtotal), 0))
    const promotionDiscount = round(calculatedItems.reduce((sum, item) => sum + Number(item.promotion_discount), 0))
    const itemDiscount = round(calculatedItems.reduce((sum, item) => sum + Number(item.item_discount), 0))
    const base = Math.max(0, subtotal - promotionDiscount - itemDiscount)
    const discountRequested = args.p_sale_discount_type === 'percent'
      ? round(base * Number(args.p_sale_discount_value ?? 0) / 100)
      : round(Number(args.p_sale_discount_value ?? 0))
    const saleDiscount = Math.min(base, discountRequested)
    const total = round(base - saleDiscount)
    const received = round(paymentArgs.reduce((sum, payment) => sum + Number(payment.amount), 0))
    const changeDue = round(Math.max(0, received - total))
    const saleId = editing?.id ?? uuid()
    const saleNumber = editing?.sale_number ?? state.nextSaleNumber++
    const sale = {
      id: saleId, company_id: args.p_company_id, sale_number: saleNumber, cash_register_id: args.p_cash_register_id,
      customer_id: args.p_customer_id ?? null, seller_name: args.p_seller_name, status: 'active',
      sold_at: args.p_sold_at ?? isoNow(), subtotal, promotion_discount: promotionDiscount,
      item_discount: itemDiscount, sale_discount: saleDiscount,
      total_discount: round(promotionDiscount + itemDiscount + saleDiscount), total, received, change_due: changeDue,
      sale_discount_type: args.p_sale_discount_type ?? 'amount', sale_discount_value: Number(args.p_sale_discount_value ?? 0),
      sale_discount_reason: args.p_sale_discount_reason ?? '', observations: args.p_observations ?? '',
      cancelled_at: null, cancelled_by: null, cancellation_reason: '', updated_at: isoNow(),
      created_by: DEMO_USER_ID, updated_by: DEMO_USER_ID,
    }
    if (editing) {
      Object.assign(editing, sale)
      tables.sale_items = tables.sale_items.filter((item) => item.sale_id !== saleId)
      tables.sale_payments = tables.sale_payments.filter((payment) => payment.sale_id !== saleId)
    } else {
      tables.sales.push(sale)
    }
    tables.sale_items.push(...calculatedItems.map(({ itemIndex: _index, ...item }) => ({ ...item, sale_id: saleId })))
    tables.stock_movements.push(...calculatedItems.map((item) => ({
      id: uuid(),
      company_id: args.p_company_id,
      product_id: item.product_id,
      type: 'Venda',
      direction: -1,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      occurred_at: sale.sold_at,
      observations: `Venda #${saleNumber}`,
      origin: 'sale',
      reference_id: saleId,
      created_by: DEMO_USER_ID,
      created_at: isoNow(),
    })))
    tables.sale_payments.push(...paymentArgs.filter((payment) => Number(payment.amount) > 0).map((payment) => ({
      id: uuid(), company_id: args.p_company_id, sale_id: saleId,
      payment_method: payment.method, payment_label: payment.label, amount: Number(payment.amount),
    })))
    return { sale_number: saleNumber, change_due: changeDue }
  }

  if (name === 'cancel_sale' || name === 'reactivate_sale') {
    const sale = tables.sales.find((row) => row.id === args.p_sale_id && row.company_id === args.p_company_id)
    if (!sale) throw new Error('sale_not_found')
    const cancelled = name === 'cancel_sale'
    if (cancelled && sale.status !== 'active') throw new Error('sale_not_active')
    if (!cancelled && sale.status !== 'cancelled') throw new Error('sale_not_cancelled')
    for (const item of tables.sale_items.filter((row) => row.sale_id === sale.id)) {
      const product = tables.products.find((row) => row.id === item.product_id)
      if (!product) continue
      const stock = Number(product.current_stock) + (cancelled ? Number(item.quantity) : -Number(item.quantity))
      if (stock < 0 && !args.p_allow_negative_stock) throw new Error('insufficient_stock')
      product.current_stock = stock
      tables.stock_movements.push({
        id: uuid(),
        company_id: args.p_company_id,
        product_id: product.id,
        type: cancelled ? 'Cancelamento de venda' : 'Reativação de venda',
        direction: cancelled ? 1 : -1,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        occurred_at: isoNow(),
        observations: `Venda #${sale.sale_number}`,
        origin: 'system',
        reference_id: sale.id,
        created_by: DEMO_USER_ID,
        created_at: isoNow(),
      })
    }
    Object.assign(sale, cancelled
      ? { status: 'cancelled', cancelled_at: isoNow(), cancelled_by: DEMO_USER_ID, cancellation_reason: args.p_reason ?? '', updated_at: isoNow() }
      : { status: 'active', cancelled_at: null, cancelled_by: null, cancellation_reason: '', updated_at: isoNow() })
    return null
  }

  throw new Error(`A operação ${name} não está disponível na demonstração.`)
}

// Existing feature components issue PostgREST requests; this local adapter routes them only to the demo store.
export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null
  const url = new URL(request?.url ?? String(input))
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const bodyText = init?.body == null ? null : String(init.body)
  const body = bodyText ? JSON.parse(bodyText) as unknown : undefined
  const segments = url.pathname.split('/').filter(Boolean)

  try {
    if (segments[0] !== 'rest' || segments[1] !== 'v1') throw new Error('Endpoint de demonstração inválido.')
    const state = readState()

    if (segments[2] === 'rpc') {
      const result = handleRpc(segments[3] ?? '', (body ?? {}) as DemoRow, state)
      writeState(state)
      return Response.json(result)
    }

    const tableName = segments[2]
    const rows = state.tables[tableName]
    if (!rows) throw new Error(`Tabela ${tableName} não disponível na demonstração.`)
    let result: DemoRow[] = []
    if (method === 'GET') {
      result = queryRows(rows, url.searchParams)
      result = projectRows(result, url.searchParams.get('select'))
    } else if (method === 'POST') {
      const inserts = Array.isArray(body) ? body as DemoRow[] : [body as DemoRow]
      const inserted = inserts.map((values) => {
        const created: DemoRow = {
          ...values,
          id: values.id ?? uuid(),
          created_at: values.created_at ?? isoNow(),
          updated_at: values.updated_at ?? isoNow(),
        }
        if (tableName === 'product_categories') Object.assign(created, { active: created.active ?? true, sort_order: created.sort_order ?? 0 })
        if (tableName === 'products') Object.assign(created, { current_stock: created.current_stock ?? 0, active: created.active ?? true, observations: created.observations ?? '', promotion: created.promotion ?? null })
        if (tableName === 'customers') Object.assign(created, { observations: created.observations ?? '', custom_fields: created.custom_fields ?? {}, archived_at: created.archived_at ?? null })
        if (tableName === 'customer_notes') Object.assign(created, { attended_by: created.attended_by ?? '' })
        if (tableName === 'customer_procurations') Object.assign(created, { details: created.details ?? '', status: created.status ?? 'open', resolved_at: created.resolved_at ?? null })
        if (tableName === 'stock_movements') Object.assign(created, { observations: created.observations ?? '', reference_id: created.reference_id ?? null })
        if (['products', 'customers'].includes(tableName)) {
          const uniqueField = tableName === 'products' ? 'code' : 'cpf'
          if (created[uniqueField] && rows.some((row) => row[uniqueField] === created[uniqueField] && row.company_id === created.company_id)) {
            throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
          }
        }
        return created
      })
      rows.push(...inserted)
      result = inserted
      writeState(state)
    } else if (method === 'PATCH') {
      const patch = body as DemoRow
      result = rows.filter((row) => matches(row, url.searchParams))
      for (const row of result) Object.assign(row, patch, { updated_at: isoNow() })
      writeState(state)
    } else if (method === 'DELETE') {
      result = rows.filter((row) => matches(row, url.searchParams))
      state.tables[tableName] = rows.filter((row) => !result.includes(row))
      writeState(state)
    } else {
      throw new Error(`Método ${method} não suportado na demonstração.`)
    }

    const responseHeaders = new Headers({ 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(result.length - 1, 0)}/${result.length}` })
    return new Response(JSON.stringify(result), { status: 200, headers: responseHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao atualizar os dados da demonstração.'
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'P0001'
    return Response.json({ message, code, details: null, hint: null }, { status: 400 })
  }
}
