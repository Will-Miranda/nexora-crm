import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { CompanyRole, Database } from './lib/database.types'
import { supabase } from './lib/supabase'

type Product = Database['public']['Tables']['products']['Row']
type Category = Database['public']['Tables']['product_categories']['Row']
type Customer = Pick<Database['public']['Tables']['customers']['Row'], 'id' | 'full_name' | 'cpf' | 'phone' | 'archived_at'>
type CashRegister = Database['public']['Tables']['cash_registers']['Row']
type Sale = Database['public']['Tables']['sales']['Row']
type SaleItem = Database['public']['Tables']['sale_items']['Row']
type SalePayment = Database['public']['Tables']['sale_payments']['Row']
type PaymentMethod = SalePayment['payment_method']
type SaleView = Sale & { items: SaleItem[]; payments: SalePayment[] }
type SalesTab = 'pos' | 'history' | 'cash'
type DiscountType = 'amount' | 'percent'

type CartLine = {
  productId: string
  name: string
  code: string | null
  category: string
  quantity: number
  unitPrice: number
  unitCost: number | null
  promotionQuantity: number | null
  promotionPrice: number | null
  promotionActive: boolean
  discountType: DiscountType
  discountValue: number
  discountReason: string
}

type PaymentDraft = {
  method: PaymentMethod
  amount: string
}

type SalesProps = {
  companyId: string
  userId: string
  userName: string
  role: CompanyRole
  initialTab: SalesTab
}

const paymentMethods: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'credit', label: 'Cartão de crédito' },
  { id: 'debit', label: 'Cartão de débito' },
  { id: 'other', label: 'Outro' },
]

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function dateTimeInput(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function promotionFor(product: Product): { quantity: number; price: number } | null {
  const promotion = product.promotion
  return promotion && Number.isInteger(promotion.qtd) && promotion.qtd >= 2 && promotion.preco >= 0
    ? { quantity: promotion.qtd, price: promotion.preco }
    : null
}

function calculateLine(line: CartLine) {
  const subtotal = roundMoney(line.quantity * line.unitPrice)
  const promotionDiscount = line.promotionActive && line.promotionQuantity && line.promotionPrice != null && line.quantity >= line.promotionQuantity
    ? roundMoney(Math.max(0, Math.floor(line.quantity / line.promotionQuantity) * (line.promotionQuantity * line.unitPrice - line.promotionPrice)))
    : 0
  const base = Math.max(0, subtotal - promotionDiscount)
  const requestedDiscount = line.discountType === 'percent'
    ? roundMoney(base * line.discountValue / 100)
    : roundMoney(line.discountValue)
  const itemDiscount = Math.min(base, requestedDiscount)
  return {
    subtotal,
    promotionDiscount,
    itemDiscount,
    total: roundMoney(base - itemDiscount),
  }
}

function calculateCart(lines: CartLine[], discountType: DiscountType, discountValue: number) {
  const lineTotals = lines.map(calculateLine)
  const subtotal = roundMoney(lineTotals.reduce((sum, line) => sum + line.subtotal, 0))
  const promotionDiscount = roundMoney(lineTotals.reduce((sum, line) => sum + line.promotionDiscount, 0))
  const itemDiscount = roundMoney(lineTotals.reduce((sum, line) => sum + line.itemDiscount, 0))
  const beforeSaleDiscount = Math.max(0, subtotal - promotionDiscount - itemDiscount)
  const requestedSaleDiscount = discountType === 'percent'
    ? roundMoney(beforeSaleDiscount * discountValue / 100)
    : roundMoney(discountValue)
  const saleDiscount = Math.min(beforeSaleDiscount, requestedSaleDiscount)
  return {
    lineTotals,
    subtotal,
    promotionDiscount,
    itemDiscount,
    saleDiscount,
    totalDiscount: roundMoney(promotionDiscount + itemDiscount + saleDiscount),
    total: roundMoney(beforeSaleDiscount - saleDiscount),
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  }
}

function getPaymentTotals(payments: PaymentDraft[], total: number) {
  const blankCount = payments.filter((payment) => !payment.amount.trim()).length
  const specified = roundMoney(payments.reduce((sum, payment) => sum + (parseMoney(payment.amount) ?? 0), 0))
  const amounts = payments.map((payment) =>
    payment.amount.trim()
      ? parseMoney(payment.amount) ?? 0
      : blankCount === 1
        ? roundMoney(Math.max(0, total - specified))
        : 0,
  )
  const received = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0))
  const change = roundMoney(Math.max(0, received - total))
  const cashReceived = roundMoney(amounts.reduce((sum, amount, index) => sum + (payments[index].method === 'cash' ? amount : 0), 0))
  return {
    amounts,
    received,
    change,
    due: roundMoney(Math.max(0, total - received)),
    changeInvalid: change > cashReceived,
  }
}

function Sales({ companyId, userId, userName, role, initialTab }: SalesProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([])
  const [sales, setSales] = useState<SaleView[]>([])
  const [tab, setTab] = useState<SalesTab>(initialTab)
  const [cart, setCart] = useState<CartLine[]>([])
  const [sellerName, setSellerName] = useState(userName)
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [saleDiscountType, setSaleDiscountType] = useState<DiscountType>('amount')
  const [saleDiscountValue, setSaleDiscountValue] = useState('')
  const [saleDiscountReason, setSaleDiscountReason] = useState('')
  const [payments, setPayments] = useState<PaymentDraft[]>([{ method: 'cash', amount: '' }])
  const [observations, setObservations] = useState('')
  const [soldAt, setSoldAt] = useState(dateTimeInput())
  const [allowNegativeStock, setAllowNegativeStock] = useState(false)
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null)
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)
  const [salesSearch, setSalesSearch] = useState('')
  const [salesStatus, setSalesStatus] = useState<'active' | 'cancelled' | 'all'>('active')
  const [salesStart, setSalesStart] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`)
  const [salesEnd, setSalesEnd] = useState(() => dateTimeInput().slice(0, 10))
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false)
  const [cashOpenValue, setCashOpenValue] = useState('')
  const [cashOperator, setCashOperator] = useState(userName)
  const [cashCounted, setCashCounted] = useState('')
  const [cashClosingNote, setCashClosingNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canManage = role === 'owner' || role === 'manager'

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError('A conexão Supabase não está configurada.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const [categoryResult, productResult, customerResult, cashResult, saleResult] = await Promise.all([
        supabase.from('product_categories').select('*').eq('company_id', companyId).order('sort_order').order('name'),
        supabase.from('products').select('*').eq('company_id', companyId).order('name').limit(2000),
        supabase.from('customers').select('id, full_name, cpf, phone, archived_at').eq('company_id', companyId).order('full_name').limit(1000),
        supabase.from('cash_registers').select('*').eq('company_id', companyId).order('opened_at', { ascending: false }).limit(200),
        supabase.from('sales').select('*').eq('company_id', companyId).order('sold_at', { ascending: false }).limit(500),
      ])
      if (categoryResult.error) throw categoryResult.error
      if (productResult.error) throw productResult.error
      if (customerResult.error) throw customerResult.error
      if (cashResult.error) throw cashResult.error
      if (saleResult.error) throw saleResult.error

      const saleIds = saleResult.data.map((sale) => sale.id)
      let itemRows: SaleItem[] = []
      let paymentRows: SalePayment[] = []
      if (saleIds.length) {
        const [itemResult, paymentResult] = await Promise.all([
          supabase.from('sale_items').select('*').eq('company_id', companyId).in('sale_id', saleIds).limit(5000),
          supabase.from('sale_payments').select('*').eq('company_id', companyId).in('sale_id', saleIds).limit(5000),
        ])
        if (itemResult.error) throw itemResult.error
        if (paymentResult.error) throw paymentResult.error
        itemRows = itemResult.data
        paymentRows = paymentResult.data
      }

      setCategories(categoryResult.data)
      setProducts(productResult.data)
      setCustomers(customerResult.data)
      setCashRegisters(cashResult.data)
      setSales(saleResult.data.map((sale) => ({
        ...sale,
        items: itemRows.filter((item) => item.sale_id === sale.id),
        payments: paymentRows.filter((payment) => payment.sale_id === sale.id),
      })))
    } catch (loadError) {
      setError(`Não foi possível carregar Vendas/PDV: ${messageFrom(loadError)}`)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    setCart([])
    setEditingSaleId(null)
    setCustomerId('')
    setSelectedSaleId(null)
    setSellerName(userName)
    void loadData()
  }, [companyId, loadData, userName])

  const openCash = cashRegisters.find((cash) => cash.status === 'open') ?? null
  const cartDiscount = Number(saleDiscountValue) || 0
  const totals = useMemo(
    () => calculateCart(cart, saleDiscountType, cartDiscount),
    [cart, cartDiscount, saleDiscountType],
  )
  const paymentTotals = useMemo(
    () => getPaymentTotals(payments, totals.total),
    [payments, totals.total],
  )
  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const selectedSale = selectedSaleId ? sales.find((sale) => sale.id === selectedSaleId) : undefined
  const categoryChoices = useMemo(
    () => [...new Set(products.map((product) => product.category_id))],
    [products],
  )
  const matchingProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase('pt-BR')
    return products.filter((product) => {
      if (!product.active || (categoryFilter && product.category_id !== categoryFilter)) return false
      if (!query) return false
      return product.name.toLocaleLowerCase('pt-BR').includes(query)
        || (product.code ?? '').toLocaleLowerCase('pt-BR').includes(query)
    }).slice(0, 30)
  }, [categoryFilter, productSearch, products])
  const matchingCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase('pt-BR')
    if (!query) return []
    const digits = query.replace(/\D/g, '')
    return customers.filter((customer) => !customer.archived_at && (
      customer.full_name.toLocaleLowerCase('pt-BR').includes(query)
      || (digits.length >= 3 && ((customer.cpf ?? '').includes(digits) || (customer.phone ?? '').replace(/\D/g, '').includes(digits)))
    )).slice(0, 8)
  }, [customerSearch, customers])

  const filteredSales = useMemo(() => {
    const query = salesSearch.trim().toLocaleLowerCase('pt-BR')
    return sales.filter((sale) => {
      if (salesStatus !== 'all' && sale.status !== salesStatus) return false
      const soldDay = sale.sold_at.slice(0, 10)
      if (salesStart && soldDay < salesStart) return false
      if (salesEnd && soldDay > salesEnd) return false
      if (!query) return true
      const clientName = customers.find((customer) => customer.id === sale.customer_id)?.full_name ?? ''
      return String(sale.sale_number).includes(query.replace(/^#/, ''))
        || sale.seller_name.toLocaleLowerCase('pt-BR').includes(query)
        || clientName.toLocaleLowerCase('pt-BR').includes(query)
        || sale.items.some((item) => item.product_name.toLocaleLowerCase('pt-BR').includes(query))
    })
  }, [customers, sales, salesEnd, salesSearch, salesStart, salesStatus])

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (existing) return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
      const promotion = promotionFor(product)
      return [...current, {
        productId: product.id,
        name: product.name,
        code: product.code,
        category: product.category_id,
        quantity: 1,
        unitPrice: product.price,
        unitCost: product.cost,
        promotionQuantity: promotion?.quantity ?? null,
        promotionPrice: promotion?.price ?? null,
        promotionActive: Boolean(promotion),
        discountType: 'amount',
        discountValue: 0,
        discountReason: '',
      }]
    })
    setProductSearch('')
  }

  function updateCartLine(productId: string, patch: Partial<CartLine>) {
    setCart((current) => current.map((line) => line.productId === productId ? { ...line, ...patch } : line))
  }

  function updatePayment(index: number, patch: Partial<PaymentDraft>) {
    setPayments((current) => current.map((payment, position) => position === index ? { ...payment, ...patch } : payment))
  }

  function addPayment() {
    const nextPayments = payments.map((payment, index) => ({
      ...payment,
      amount: payment.amount.trim() ? payment.amount : String(paymentTotals.amounts[index] ?? 0),
    }))
    const amountUsed = roundMoney(nextPayments.reduce((sum, payment) => sum + (parseMoney(payment.amount) ?? 0), 0))
    const method = paymentMethods.find((item) => !payments.some((payment) => payment.method === item.id))?.id ?? 'cash'
    setPayments([...nextPayments, { method, amount: String(roundMoney(Math.max(0, totals.total - amountUsed))) }])
  }

  function removePayment(index: number) {
    setPayments((current) => current.filter((_payment, position) => position !== index))
  }

  function resetSale() {
    if (cart.length && !window.confirm(editingSaleId ? 'Descartar as alterações desta venda?' : 'Limpar a venda atual?')) return
    setCart([])
    setEditingSaleId(null)
    setCustomerId('')
    setCustomerSearch('')
    setSaleDiscountType('amount')
    setSaleDiscountValue('')
    setSaleDiscountReason('')
    setPayments([{ method: 'cash', amount: '' }])
    setObservations('')
    setSoldAt(dateTimeInput())
    setAllowNegativeStock(false)
    setNotice('')
  }

  function startEditingSale(sale: SaleView) {
    if (!canManage || sale.status !== 'active') return
    setCart(sale.items.map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      code: item.product_code,
      category: item.category_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      unitCost: item.unit_cost,
      promotionQuantity: item.promotion_quantity,
      promotionPrice: item.promotion_price,
      promotionActive: item.promotion_active,
      discountType: item.discount_type,
      discountValue: item.discount_value,
      discountReason: item.discount_reason,
    })))
    const cashPayments = sale.payments.map((payment) => ({ ...payment, amount: payment.amount }))
    const lastCashPayment = [...cashPayments].reverse().find((payment) => payment.payment_method === 'cash')
    if (lastCashPayment) lastCashPayment.amount = roundMoney(lastCashPayment.amount + sale.change_due)
    setPayments(cashPayments.map((payment) => ({ method: payment.payment_method, amount: String(payment.amount) })))
    setCustomerId(sale.customer_id ?? '')
    setSellerName(sale.seller_name)
    setSaleDiscountType(sale.sale_discount_type)
    setSaleDiscountValue(sale.sale_discount_value ? String(sale.sale_discount_value) : '')
    setSaleDiscountReason(sale.sale_discount_reason)
    setObservations(sale.observations)
    setSoldAt(dateTimeInput(sale.sold_at))
    setEditingSaleId(sale.id)
    setSelectedSaleId(null)
    setTab('pos')
    setNotice(`Editando venda #${sale.sale_number}. O caixa original será mantido.`)
    setError('')
  }

  async function saveSale(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!supabase) return
    if (!editingSaleId && !openCash) {
      setError('Abra o caixa antes de finalizar uma venda.')
      setTab('cash')
      return
    }
    if (!cart.length) {
      setError('Adicione ao menos um produto à venda.')
      return
    }
    if (!sellerName.trim()) {
      setError('Informe o vendedor para finalizar a venda.')
      return
    }
    if (paymentTotals.due > 0) {
      setError(`Pagamento incompleto. Falta ${money(paymentTotals.due)}.`)
      return
    }
    if (paymentTotals.changeInvalid) {
      setError('O troco só pode ser devolvido a partir de pagamento em dinheiro.')
      return
    }
    if (cart.some((line) => line.discountValue > 0 && !line.discountReason.trim())) {
      setError('Informe o motivo de cada desconto aplicado a um item.')
      return
    }
    if (cartDiscount > 0 && !saleDiscountReason.trim()) {
      setError('Informe o motivo do desconto da venda.')
      return
    }

    const paymentPayload = payments.map((payment, index) => {
      const option = paymentMethods.find((method) => method.id === payment.method)
      return { method: payment.method, label: option?.label ?? payment.method, amount: paymentTotals.amounts[index] ?? 0 }
    }).filter((payment) => payment.amount > 0)
    if (!paymentPayload.length && totals.total === 0) {
      paymentPayload.push({ method: 'cash', label: 'Dinheiro', amount: 0 })
    }
    const itemPayload = cart.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      promotion_quantity: line.promotionQuantity,
      promotion_price: line.promotionPrice,
      promotion_active: line.promotionActive,
      discount_type: line.discountType,
      discount_value: line.discountValue,
      discount_reason: line.discountReason,
    }))
    const salePayload = {
      p_company_id: companyId,
      p_cash_register_id: editingSaleId
        ? sales.find((sale) => sale.id === editingSaleId)?.cash_register_id ?? openCash?.id ?? ''
        : openCash?.id ?? '',
      p_sale_id: editingSaleId,
      p_customer_id: customerId || null,
      p_seller_name: sellerName.trim(),
      p_items: itemPayload,
      p_payments: paymentPayload,
      p_sale_discount_type: saleDiscountType,
      p_sale_discount_value: cartDiscount,
      p_sale_discount_reason: saleDiscountReason.trim(),
      p_observations: observations.trim(),
      p_sold_at: new Date(soldAt).toISOString(),
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      let { data, error: saveError } = await supabase.rpc('save_sale', {
        ...salePayload,
        p_allow_negative_stock: allowNegativeStock,
      })
      if (saveError?.message.includes('insufficient_stock') && canManage && !allowNegativeStock
          && window.confirm('O estoque ficará negativo. Deseja autorizar e registrar a venda mesmo assim?')) {
        const retry = await supabase.rpc('save_sale', {
          ...salePayload,
          p_allow_negative_stock: true,
        })
        data = retry.data
        saveError = retry.error
      }
      if (saveError) throw saveError
      if (!data || typeof data !== 'object' || Array.isArray(data) || !('sale_number' in data)) {
        throw new Error('O banco não retornou os dados da venda finalizada.')
      }
      const saleNumber = Number(data.sale_number)
      const change = Number(data.change_due ?? 0)
      setNotice(editingSaleId
        ? `Venda #${saleNumber} atualizada com sucesso.`
        : `Venda #${saleNumber} finalizada${change ? ` · troco ${money(change)}` : ''}.`)
      setCart([])
      setEditingSaleId(null)
      setCustomerId('')
      setSaleDiscountType('amount')
      setSaleDiscountValue('')
      setSaleDiscountReason('')
      setPayments([{ method: 'cash', amount: '' }])
      setObservations('')
      setSoldAt(dateTimeInput())
      setAllowNegativeStock(false)
      await loadData()
    } catch (saveError) {
      setError(`Não foi possível finalizar a venda: ${messageFrom(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function openRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const openingCash = parseMoney(cashOpenValue)
    if (openingCash == null || openingCash < 0) {
      setError('Informe um valor válido para o troco inicial.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: openError } = await supabase.rpc('open_cash_register', {
        p_company_id: companyId,
        p_opening_cash: openingCash,
        p_operator_name: cashOperator.trim(),
      })
      if (openError) throw openError
      setCashOpenValue('')
      setNotice('Caixa aberto. Já é possível registrar vendas.')
      await loadData()
    } catch (openError) {
      setError(`Não foi possível abrir o caixa: ${messageFrom(openError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function closeRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !openCash) return
    const countedCash = parseMoney(cashCounted)
    if (countedCash == null || countedCash < 0) {
      setError('Informe o valor contado na gaveta.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: closeError } = await supabase.rpc('close_cash_register', {
        p_company_id: companyId,
        p_cash_register_id: openCash.id,
        p_counted_cash: countedCash,
        p_closing_note: cashClosingNote.trim(),
      })
      if (closeError) throw closeError
      setCashCounted('')
      setCashClosingNote('')
      setNotice('Caixa fechado e conferência registrada.')
      await loadData()
    } catch (closeError) {
      setError(`Não foi possível fechar o caixa: ${messageFrom(closeError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveQuickCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !canManage) return
    const formData = new FormData(event.currentTarget)
    const fullName = String(formData.get('fullName') ?? '').trim()
    const phone = String(formData.get('phone') ?? '').trim()
    const cpf = String(formData.get('cpf') ?? '').replace(/\D/g, '')
    if (fullName.length < 2) {
      setError('Informe o nome do cliente.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data: created, error: createError } = await supabase
        .from('customers')
        .insert({
          company_id: companyId,
          full_name: fullName,
          phone: phone || null,
          cpf: cpf || null,
          created_by: userId,
        })
        .select('id')
        .single()
      if (createError?.code === '23505') throw new Error('Já existe um cliente com este CPF nesta empresa.')
      if (createError) throw createError
      await loadData()
      setCustomerId(created.id)
      setCustomerSearch('')
      setQuickCustomerOpen(false)
      setNotice('Cliente cadastrado e vinculado à venda.')
    } catch (createError) {
      setError(`Não foi possível cadastrar o cliente: ${messageFrom(createError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function cancelSale(sale: SaleView) {
    if (!supabase || !canManage) return
    const reason = window.prompt(`Motivo para cancelar a venda #${sale.sale_number}:`)
    if (reason === null) return
    setSaving(true)
    setError('')
    try {
      const { error: cancelError } = await supabase.rpc('cancel_sale', {
        p_company_id: companyId,
        p_sale_id: sale.id,
        p_reason: reason.trim(),
      })
      if (cancelError) throw cancelError
      setSelectedSaleId(null)
      setNotice(`Venda #${sale.sale_number} cancelada. Os itens foram devolvidos ao estoque.`)
      await loadData()
    } catch (cancelError) {
      setError(`Não foi possível cancelar a venda: ${messageFrom(cancelError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function reactivateSale(sale: SaleView, allowNegative = false) {
    if (!supabase || !canManage) return
    setSaving(true)
    setError('')
    try {
      let { error: reactivateError } = await supabase.rpc('reactivate_sale', {
        p_company_id: companyId,
        p_sale_id: sale.id,
        p_allow_negative_stock: allowNegative,
      })
      if (reactivateError?.message.includes('insufficient_stock') && !allowNegative
          && window.confirm('O estoque ficará negativo. Deseja reativar a venda mesmo assim?')) {
        const retry = await supabase.rpc('reactivate_sale', {
          p_company_id: companyId,
          p_sale_id: sale.id,
          p_allow_negative_stock: true,
        })
        reactivateError = retry.error
      }
      if (reactivateError) throw reactivateError
      setSelectedSaleId(null)
      setNotice(`Venda #${sale.sale_number} reativada.`)
      await loadData()
    } catch (reactivateError) {
      setError(`Não foi possível reativar a venda: ${messageFrom(reactivateError)}`)
    } finally {
      setSaving(false)
    }
  }

  const saleTabs: { id: SalesTab; label: string }[] = [
    { id: 'pos', label: 'PDV' },
    { id: 'history', label: 'Vendas realizadas' },
    { id: 'cash', label: 'Caixa básico' },
  ]

  return (
    <section className="sales-module">
      <div className="section-heading sales-heading">
        <div><span className="eyebrow">MÓDULO 3 · VENDAS E PDV</span><h2>Vendas e ponto de venda</h2></div>
        <span className={`cash-state${openCash ? ' open' : ''}`}>{openCash ? `Caixa aberto · ${new Date(openCash.opened_at).toLocaleString('pt-BR')}` : 'Caixa fechado'}</span>
      </div>

      {error && <p className="form-alert error sales-alert" role="alert">{error}</p>}
      {notice && <p className="form-alert success sales-alert" role="status">{notice}</p>}

      <div className="sales-tabs" role="tablist" aria-label="Vendas, histórico e caixa">
        {saleTabs.map((item) => (
          <button aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">
            {item.label}
          </button>
        ))}
      </div>

      {loading ? <p className="sales-empty" role="status">Carregando vendas e estoque…</p> : null}
      {!loading && sales.length >= 500 && <p className="sales-hint">O histórico exibe as 500 vendas mais recentes. Use a busca para localizar um registro nesta lista.</p>}

      {!loading && tab === 'pos' && (
        !openCash && !editingSaleId ? (
          <div className="sales-empty-card">
            <h3>Abra o caixa para começar</h3>
            <p>O PDV do sistema original só permite finalizar vendas vinculadas a um caixa aberto.</p>
            <button className="customer-primary-button" onClick={() => setTab('cash')} type="button">Abrir caixa</button>
          </div>
        ) : (
          <div className="sales-pos-layout">
            <div className="sales-pos-main">
              <section className="customer-card sales-product-search">
                <div className="sales-search-row">
                  <input aria-label="Buscar produto ou código" autoComplete="off" onChange={(event) => setProductSearch(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && matchingProducts[0]) {
                      event.preventDefault()
                      addProduct(matchingProducts[0])
                    }
                  }} placeholder="Buscar produto ou código… (Enter adiciona o 1º)" value={productSearch} />
                  <select aria-label="Filtrar produtos por categoria" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                    <option value="">Todas as categorias</option>
                    {categoryChoices.map((categoryId) => <option key={categoryId} value={categoryId}>{categories.find((category) => category.id === categoryId)?.name ?? 'Categoria'}</option>)}
                  </select>
                </div>
                {productSearch.trim() && (
                  <div className="sales-product-results">
                    {matchingProducts.length ? matchingProducts.map((product) => (
                      <button className="sales-product-result" key={product.id} onClick={() => addProduct(product)} type="button">
                        <span><strong>{product.name}</strong><small>{product.code || 'Sem código'} · estoque {product.current_stock}</small></span>
                        <span>{money(product.price)} <b>Adicionar</b></span>
                      </button>
                    )) : <p className="sales-empty">Nenhum produto ativo encontrado.</p>}
                  </div>
                )}
              </section>

              <section className="customer-card">
                <div className="customer-list-heading"><div><h3>Itens da venda</h3><p>{totals.quantity} peça(s) · subtotal {money(totals.subtotal)}</p></div></div>
                {!cart.length ? <p className="sales-empty">Busque um produto para adicioná-lo à venda.</p> : (
                  <div className="sales-cart-lines">
                    {cart.map((line, index) => {
                      const lineTotals = totals.lineTotals[index]
                      const product = products.find((item) => item.id === line.productId)
                      return (
                        <article className="sales-cart-line" key={line.productId}>
                          <div className="sales-cart-product">
                            <strong>{line.name}</strong>
                            <small>{line.code || 'Sem código'} · estoque disponível {product?.current_stock ?? '—'}</small>
                            {line.promotionQuantity && <label className="sales-promo-toggle"><input checked={line.promotionActive} onChange={(event) => updateCartLine(line.productId, { promotionActive: event.target.checked })} type="checkbox" /> Promoção {line.promotionQuantity} por {money(line.promotionPrice ?? 0)}{lineTotals.promotionDiscount ? ` · -${money(lineTotals.promotionDiscount)}` : ''}</label>}
                          </div>
                          <label className="sales-line-input">Qtd<input min="1" onChange={(event) => updateCartLine(line.productId, { quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} type="number" value={line.quantity} /></label>
                          <label className="sales-line-input">Preço un. (R$)<input min="0" onChange={(event) => updateCartLine(line.productId, { unitPrice: Math.max(0, Number(event.target.value) || 0) })} step="0.01" type="number" value={line.unitPrice} /></label>
                          <div className="sales-line-discount">
                            <label>Desconto <select onChange={(event) => updateCartLine(line.productId, { discountType: event.target.value as DiscountType })} value={line.discountType}><option value="amount">R$</option><option value="percent">%</option></select></label>
                            <input aria-label={`Valor do desconto em ${line.name}`} min="0" onChange={(event) => updateCartLine(line.productId, { discountValue: Math.max(0, Number(event.target.value) || 0) })} step="0.01" type="number" value={line.discountValue || ''} />
                            {line.discountValue > 0 && <input aria-label={`Motivo do desconto em ${line.name}`} maxLength={300} onChange={(event) => updateCartLine(line.productId, { discountReason: event.target.value })} placeholder="Motivo obrigatório" value={line.discountReason} />}
                          </div>
                          <strong className="sales-line-total">{money(lineTotals.total)}</strong>
                          <button aria-label={`Remover ${line.name}`} className="customer-quiet-button small danger" onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))} type="button">Remover</button>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>

            <div className="sales-pos-side">
              <section className="customer-card sales-side-card">
                <h3>Venda</h3>
                <label>Vendedor *<input maxLength={120} onChange={(event) => setSellerName(event.target.value)} required value={sellerName} /></label>
                <label>Cliente (opcional)
                  {selectedCustomer ? (
                    <div className="sales-selected-customer"><span><strong>{selectedCustomer.full_name}</strong><small>{selectedCustomer.phone || selectedCustomer.cpf || 'Sem contato'}</small></span><button className="customer-quiet-button small" onClick={() => setCustomerId('')} type="button">Trocar</button></div>
                  ) : (
                    <>
                      <input autoComplete="off" onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Buscar nome, CPF ou telefone…" value={customerSearch} />
                      {!!matchingCustomers.length && <div className="sales-customer-results">{matchingCustomers.map((customer) => <button key={customer.id} onClick={() => { setCustomerId(customer.id); setCustomerSearch('') }} type="button"><strong>{customer.full_name}</strong><small>{customer.phone || customer.cpf || 'Sem contato'}</small></button>)}</div>}
                      {customerSearch.trim() && !matchingCustomers.length && <small className="customer-muted">Nenhum cliente encontrado.</small>}
                      {!canManage ? <small className="customer-muted">Um gerente pode cadastrar clientes rapidamente ou na área Clientes.</small> : <button className="customer-quiet-button small" onClick={() => setQuickCustomerOpen((value) => !value)} type="button">+ Cadastro rápido</button>}
                    </>
                  )}
                </label>
                {quickCustomerOpen && canManage && (
                  <form className="sales-quick-customer" onSubmit={(event) => void saveQuickCustomer(event)}>
                    <label>Nome *<input maxLength={180} name="fullName" required /></label>
                    <label>Telefone<input maxLength={40} name="phone" /></label>
                    <label>CPF<input inputMode="numeric" maxLength={23} name="cpf" /></label>
                    <button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar e vincular'}</button>
                  </form>
                )}
              </section>

              <section className="customer-card sales-side-card">
                <h3>Resumo</h3>
                <div className="sales-total-row"><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
                <div className="sales-total-row"><span>Promoções</span><strong>{totals.promotionDiscount ? `− ${money(totals.promotionDiscount)}` : '—'}</strong></div>
                <div className="sales-total-row"><span>Descontos nos itens</span><strong>{totals.itemDiscount ? `− ${money(totals.itemDiscount)}` : '—'}</strong></div>
                <div className="sales-sale-discount">
                  <label>Desconto na venda<select onChange={(event) => setSaleDiscountType(event.target.value as DiscountType)} value={saleDiscountType}><option value="amount">R$</option><option value="percent">%</option></select></label>
                  <input aria-label="Valor do desconto na venda" min="0" onChange={(event) => setSaleDiscountValue(event.target.value)} step="0.01" type="number" value={saleDiscountValue} />
                  {cartDiscount > 0 && <input aria-label="Motivo do desconto na venda" maxLength={300} onChange={(event) => setSaleDiscountReason(event.target.value)} placeholder="Motivo obrigatório" value={saleDiscountReason} />}
                </div>
                <div className="sales-total-row sales-grand-total"><span>Total</span><strong>{money(totals.total)}</strong></div>
              </section>

              <section className="customer-card sales-side-card">
                <h3>Pagamento</h3>
                {payments.map((payment, index) => (
                  <div className="sales-payment-row" key={`payment-${index}`}>
                    <select aria-label={`Forma de pagamento ${index + 1}`} onChange={(event) => updatePayment(index, { method: event.target.value as PaymentMethod })} value={payment.method}>
                      {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
                    </select>
                    <input aria-label={`Valor recebido ${index + 1}`} min="0" onChange={(event) => updatePayment(index, { amount: event.target.value })} placeholder={money(paymentTotals.amounts[index] ?? totals.total)} step="0.01" type="number" value={payment.amount} />
                    {payments.length > 1 && <button aria-label={`Remover forma de pagamento ${index + 1}`} className="customer-quiet-button small danger" onClick={() => removePayment(index)} type="button">×</button>}
                  </div>
                ))}
                <button className="customer-quiet-button small" onClick={addPayment} type="button">+ Dividir pagamento</button>
                <p className={paymentTotals.due ? 'sales-payment-warning' : paymentTotals.changeInvalid ? 'sales-payment-warning' : 'sales-payment-ok'}>
                  {paymentTotals.due ? `Falta ${money(paymentTotals.due)}`
                    : paymentTotals.changeInvalid ? 'O troco precisa sair do dinheiro recebido.'
                      : paymentTotals.change ? `Troco: ${money(paymentTotals.change)}`
                        : cart.length ? 'Pagamento conferido' : 'Adicione itens para calcular.'}
                </p>
                <small className="customer-muted">Um campo vazio recebe o restante quando houver apenas um.</small>
                {editingSaleId && <label>Data e hora<input onChange={(event) => setSoldAt(event.target.value)} required type="datetime-local" value={soldAt} /></label>}
                <label>Observação<input maxLength={2000} onChange={(event) => setObservations(event.target.value)} value={observations} /></label>
                {canManage && <label className="sales-negative-stock"><input checked={allowNegativeStock} onChange={(event) => setAllowNegativeStock(event.target.checked)} type="checkbox" /> Permitir estoque negativo se necessário</label>}
                <button className="customer-primary-button sales-finalize" disabled={saving || !cart.length || paymentTotals.due > 0 || paymentTotals.changeInvalid} onClick={() => void saveSale()} type="button">
                  {saving ? 'Salvando…' : editingSaleId ? 'Salvar alterações' : `Finalizar venda · ${money(totals.total)}`}
                </button>
                <button className="customer-quiet-button sales-clear" disabled={saving} onClick={resetSale} type="button">{editingSaleId ? 'Descartar edição' : 'Limpar venda'}</button>
              </section>
            </div>
          </div>
        )
      )}

      {!loading && tab === 'history' && (
        selectedSale ? (
          <section className="customer-card sales-sale-detail">
            <div className="customer-detail-top"><button className="customer-quiet-button" onClick={() => setSelectedSaleId(null)} type="button">← Voltar às vendas</button>
              <div className="customer-detail-actions">
                {selectedSale.status === 'active' && canManage && <button className="customer-quiet-button" disabled={saving} onClick={() => startEditingSale(selectedSale)} type="button">Editar</button>}
                {selectedSale.status === 'active' && canManage && <button className="customer-quiet-button danger" disabled={saving} onClick={() => void cancelSale(selectedSale)} type="button">Cancelar venda</button>}
                {selectedSale.status === 'cancelled' && canManage && <button className="customer-primary-button" disabled={saving} onClick={() => void reactivateSale(selectedSale)} type="button">Reativar</button>}
                <button className="customer-quiet-button" onClick={() => window.print()} type="button">Imprimir</button>
              </div>
            </div>
            <div className="sales-detail-heading"><span className={`sale-status ${selectedSale.status}`}>{selectedSale.status === 'active' ? 'Ativa' : 'Cancelada'}</span><h3>Venda #{selectedSale.sale_number}</h3>
              <p>{new Date(selectedSale.sold_at).toLocaleString('pt-BR')} · Vendedor: {selectedSale.seller_name} · {customers.find((customer) => customer.id === selectedSale.customer_id)?.full_name ?? 'Cliente não identificado'}</p>
              {selectedSale.cancelled_at && <p className="sales-payment-warning">Cancelada em {new Date(selectedSale.cancelled_at).toLocaleString('pt-BR')}{selectedSale.cancellation_reason ? ` · ${selectedSale.cancellation_reason}` : ''}</p>}
            </div>
            <div className="sales-table-wrap"><table className="customer-table"><thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Descontos</th><th>Total</th></tr></thead>
              <tbody>{selectedSale.items.map((item) => <tr key={item.id}><td><strong>{item.product_name}</strong><small>{item.category_name}</small></td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{item.promotion_discount || item.item_discount ? `− ${money(item.promotion_discount + item.item_discount)}` : '—'}{item.discount_reason && <small>{item.discount_reason}</small>}</td><td><strong>{money(item.total)}</strong></td></tr>)}</tbody>
            </table></div>
            <div className="sales-detail-totals">
              <p><span>Subtotal</span><strong>{money(selectedSale.subtotal)}</strong></p>
              <p><span>Promoções</span><strong>− {money(selectedSale.promotion_discount)}</strong></p>
              <p><span>Descontos nos itens</span><strong>− {money(selectedSale.item_discount)}</strong></p>
              <p><span>Desconto na venda</span><strong>− {money(selectedSale.sale_discount)}</strong></p>
              <p className="sales-grand-total"><span>Total</span><strong>{money(selectedSale.total)}</strong></p>
              <p><span>Recebido · troco</span><strong>{money(selectedSale.received)} · {money(selectedSale.change_due)}</strong></p>
              <p><span>Pagamentos</span><strong>{selectedSale.payments.map((payment) => `${payment.payment_label}: ${money(payment.amount)}`).join(' · ') || '—'}</strong></p>
              {selectedSale.observations && <p><span>Observação</span><strong>{selectedSale.observations}</strong></p>}
            </div>
          </section>
        ) : (
          <section className="customer-card">
            <div className="customer-toolbar sales-toolbar">
              <input aria-label="Buscar número, cliente, vendedor ou produto" onChange={(event) => setSalesSearch(event.target.value)} placeholder="Nº, cliente, vendedor ou produto…" type="search" value={salesSearch} />
              <label>De<input aria-label="Vendas desde" onChange={(event) => setSalesStart(event.target.value)} type="date" value={salesStart} /></label>
              <label>Até<input aria-label="Vendas até" onChange={(event) => setSalesEnd(event.target.value)} type="date" value={salesEnd} /></label>
              <select aria-label="Filtrar status das vendas" onChange={(event) => setSalesStatus(event.target.value as 'active' | 'cancelled' | 'all')} value={salesStatus}>
                <option value="active">Ativas</option><option value="cancelled">Canceladas</option><option value="all">Todos os status</option>
              </select>
            </div>
            <div className="sales-summary">
              <article><span>Vendas ativas exibidas</span><strong>{filteredSales.filter((sale) => sale.status === 'active').length}</strong></article>
              <article><span>Faturamento líquido</span><strong>{money(filteredSales.filter((sale) => sale.status === 'active').reduce((sum, sale) => sum + sale.total, 0))}</strong></article>
              <article><span>Descontos</span><strong>{money(filteredSales.filter((sale) => sale.status === 'active').reduce((sum, sale) => sum + sale.total_discount, 0))}</strong></article>
              <article><span>Peças vendidas</span><strong>{filteredSales.filter((sale) => sale.status === 'active').reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)}</strong></article>
            </div>
            {filteredSales.length ? <div className="sales-table-wrap"><table className="customer-table">
              <thead><tr><th>Nº / Data</th><th>Vendedor</th><th>Cliente</th><th>Itens</th><th>Desconto</th><th>Total</th><th>Pagamento</th><th /></tr></thead>
              <tbody>{filteredSales.map((sale) => (
                <tr className={sale.status === 'cancelled' ? 'customer-archived' : ''} key={sale.id}>
                  <td><strong>#{sale.sale_number}</strong><small>{new Date(sale.sold_at).toLocaleString('pt-BR')}</small></td>
                  <td>{sale.seller_name}</td>
                  <td>{customers.find((customer) => customer.id === sale.customer_id)?.full_name ?? '—'}</td>
                  <td>{sale.items.map((item) => `${item.quantity}× ${item.product_name}`).join(', ') || '—'}</td>
                  <td>{sale.total_discount ? `− ${money(sale.total_discount)}` : '—'}</td>
                  <td><strong>{money(sale.total)}</strong>{sale.status === 'cancelled' && <small>Cancelada</small>}</td>
                  <td>{sale.payments.map((payment) => payment.payment_label).join(' + ') || '—'}</td>
                  <td><button className="customer-quiet-button small" onClick={() => setSelectedSaleId(sale.id)} type="button">Detalhes</button></td>
                </tr>
              ))}</tbody>
            </table></div> : <p className="sales-empty">{sales.length ? 'Nenhuma venda encontrada com esses filtros.' : 'Ainda não há vendas registradas.'}</p>}
          </section>
        )
      )}

      {!loading && tab === 'cash' && (
        <section className="customer-card sales-cash">
          {openCash ? (
            <>
              <div className="customer-list-heading"><div><span className="cash-state open">CAIXA ABERTO</span><h3>Conferência e fechamento</h3><p>Aberto em {new Date(openCash.opened_at).toLocaleString('pt-BR')}{openCash.operator_name ? ` · ${openCash.operator_name}` : ''}</p></div></div>
              <div className="sales-cash-summary">
                <article><span>Troco inicial</span><strong>{money(openCash.opening_cash)}</strong></article>
              </div>
              {openCash.opened_by === userId || canManage ? (
                <form className="sales-cash-form" onSubmit={(event) => void closeRegister(event)}>
                  <label>Dinheiro contado na gaveta (R$) *<input min="0" onChange={(event) => setCashCounted(event.target.value)} required step="0.01" type="number" value={cashCounted} /></label>
                  <label>Observação do fechamento<input maxLength={2000} onChange={(event) => setCashClosingNote(event.target.value)} value={cashClosingNote} /></label>
                  <p className="customer-hint">O valor esperado será calculado no banco considerando o troco inicial e todos os pagamentos em dinheiro deste caixa.</p>
                  <button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Fechando…' : 'Fechar caixa'}</button>
                </form>
              ) : <p className="customer-hint">Apenas quem abriu o caixa ou um gerente pode fechá-lo.</p>}
            </>
          ) : (
            <>
              <div className="customer-list-heading"><div><span className="cash-state">CAIXA FECHADO</span><h3>Abertura de caixa</h3><p>Informe o troco inicial para liberar as vendas.</p></div></div>
              <form className="sales-cash-form" onSubmit={(event) => void openRegister(event)}>
                <label>Troco inicial (R$)<input min="0" onChange={(event) => setCashOpenValue(event.target.value)} required step="0.01" type="number" value={cashOpenValue} /></label>
                <label>Operador<input maxLength={120} onChange={(event) => setCashOperator(event.target.value)} value={cashOperator} /></label>
                <button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Abrindo…' : 'Abrir caixa'}</button>
              </form>
            </>
          )}
          {cashRegisters.length > 0 && (
            <div className="sales-cash-history">
              <h3>Caixas recentes</h3>
              <div className="sales-table-wrap"><table className="customer-table">
                <thead><tr><th>Abertura</th><th>Operador</th><th>Troco inicial</th><th>Fechamento</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead>
                <tbody>{cashRegisters.map((cash) => <tr key={cash.id}>
                  <td>{new Date(cash.opened_at).toLocaleString('pt-BR')}</td><td>{cash.operator_name || '—'}</td><td>{money(cash.opening_cash)}</td>
                  <td>{cash.closed_at ? new Date(cash.closed_at).toLocaleString('pt-BR') : <span className="cash-state open">Aberto</span>}</td>
                  <td>{cash.expected_cash == null ? '—' : money(cash.expected_cash)}</td><td>{cash.counted_cash == null ? '—' : money(cash.counted_cash)}</td>
                  <td>{cash.difference == null ? '—' : money(cash.difference)}{cash.closing_note && <small>{cash.closing_note}</small>}</td>
                </tr>)}</tbody>
              </table></div>
            </div>
          )}
          <p className="customer-hint">Esta etapa inclui abertura, fechamento e conferência básica. Suprimentos, sangrias e conferência por forma de pagamento ficam para a fase completa do módulo Caixa.</p>
        </section>
      )}
    </section>
  )
}

export default Sales
