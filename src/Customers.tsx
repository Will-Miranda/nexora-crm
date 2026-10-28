import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { CompanyRole, Database } from './lib/database.types'
import { supabase } from './lib/supabase'

type Customer = Database['public']['Tables']['customers']['Row']
type CustomerNote = Database['public']['Tables']['customer_notes']['Row']
type CustomerProcure = Database['public']['Tables']['customer_procurations']['Row']
type CustomerContact = Database['public']['Tables']['customer_contacts']['Row']
type CustomerSale = Pick<Database['public']['Tables']['sales']['Row'], 'id' | 'sale_number' | 'sold_at' | 'status' | 'total'>
type CustomerSaleItem = Pick<Database['public']['Tables']['sale_items']['Row'], 'sale_id' | 'product_name' | 'quantity'>
type CustomerCategory = Pick<Database['public']['Tables']['product_categories']['Row'], 'id' | 'name'>
type CustomerSettings = Database['public']['Tables']['customer_settings']['Row']
type CustomerTab = 'customers' | 'inactive' | 'procurations' | 'birthdays' | 'settings'
type CustomerDetailTab = 'profile' | 'notes' | 'procurations' | 'contacts'
type BirthdayRange = 'week' | 'month'
type PurchaseSummary = { count: number; total: number; lastSaleAt: string | null }
type CustomerSaleHistory = CustomerSale & { items: CustomerSaleItem[] }

const defaultSettings = {
  inactive_days: 60,
  whatsapp_message: 'Olá {primeiro_nome}! Aqui é da {loja}. Chegaram novidades que têm a sua cara. Passa aqui pra conferir!',
  birthday_message: 'Feliz aniversário, {primeiro_nome}! 🎉 A {loja} preparou um presente pra você: passe na loja esta semana e ganhe um desconto especial.',
  procure_message: 'Olá {primeiro_nome}! Aqui é da {loja}. Chegou o que você estava procurando: {procura}. Quer que a gente separe pra você?',
}

const statusLabels: Record<CustomerProcure['status'], string> = {
  open: 'Procurando',
  fulfilled: 'Atendido',
  abandoned: 'Desistiu',
}

const cpfDigits = (value: string) => value.replace(/\D/g, '')
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const formatCpf = (value: string) => {
  const digits = cpfDigits(value).slice(0, 11)
  if (digits.length !== 11) return digits
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function isValidCpf(value: string): boolean {
  const digits = cpfDigits(value)
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  for (let index = 9; index < 11; index++) {
    let sum = 0
    for (let position = 0; position < index; position++) {
      sum += Number(digits[position]) * (index + 1 - position)
    }
    if (((sum * 10) % 11) % 10 !== Number(digits[index])) return false
  }
  return true
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

async function loadCustomerSaleHistory(companyId: string, customerId: string): Promise<{ sales: CustomerSaleHistory[]; itemsTruncated: boolean }> {
  if (!supabase) throw new Error('A conexão Supabase não está configurada.')
  const { data: saleRows, error: salesError } = await supabase
    .from('sales')
    .select('id, sale_number, sold_at, status, total')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .order('sold_at', { ascending: false })
    .limit(200)
  if (salesError) throw salesError
  if (!saleRows.length) return { sales: [], itemsTruncated: false }

  const { data: itemRows, error: itemsError } = await supabase
    .from('sale_items')
    .select('sale_id, product_name, quantity')
    .eq('company_id', companyId)
    .in('sale_id', saleRows.map((sale) => sale.id))
    .limit(2000)
  if (itemsError) throw itemsError
  return {
    sales: saleRows.map((sale) => ({
      ...sale,
      items: itemRows.filter((item) => item.sale_id === sale.id),
    })),
    itemsTruncated: itemRows.length >= 2000,
  }
}

function daysUntilBirthday(birthDate: string): { days: number; age: number } {
  const [year, month, day] = birthDate.split('-').map(Number)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day)

  return {
    days: Math.round((next.getTime() - today.getTime()) / 86_400_000),
    age: next.getFullYear() - year,
  }
}

function isCpfFormatValid(value: string): boolean {
  const digits = cpfDigits(value)
  return digits.length <= 20
}

type CustomersProps = {
  companyId: string
  companyName: string
  userId: string
  role: CompanyRole
}

function Customers({ companyId, companyName, userId, role }: CustomersProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [procurations, setProcurations] = useState<CustomerProcure[]>([])
  const [categories, setCategories] = useState<CustomerCategory[]>([])
  const [settings, setSettings] = useState<CustomerSettings | null>(null)
  const [notes, setNotes] = useState<CustomerNote[]>([])
  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [customerSales, setCustomerSales] = useState<CustomerSaleHistory[]>([])
  const [customerSaleItemsTruncated, setCustomerSaleItemsTruncated] = useState(false)
  const [salesSummary, setSalesSummary] = useState<Map<string, PurchaseSummary>>(new Map())
  const [salesSummaryTruncated, setSalesSummaryTruncated] = useState(false)
  const [tab, setTab] = useState<CustomerTab>('customers')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<CustomerDetailTab>('profile')
  const [birthdayRange, setBirthdayRange] = useState<BirthdayRange>('week')
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [neighborhoodFilter, setNeighborhoodFilter] = useState('')
  const [procurationFilter, setProcurationFilter] = useState<'open' | 'all'>('open')
  const [customerFormId, setCustomerFormId] = useState<string | null>(null)
  const [procureFormId, setProcureFormId] = useState<string | null>(null)
  const [noteFormId, setNoteFormId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
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
      const [customerResult, procureResult, categoryResult, settingsResult, salesResult] = await Promise.all([
        supabase
          .from('customers')
          .select('*')
          .eq('company_id', companyId)
          .order('full_name')
          .limit(1000),
        supabase
          .from('customer_procurations')
          .select('*')
          .eq('company_id', companyId)
          .order('occurred_on', { ascending: false })
          .limit(1000),
        supabase
          .from('product_categories')
          .select('id, name')
          .eq('company_id', companyId)
          .order('sort_order')
          .order('name'),
        supabase
          .from('customer_settings')
          .select('*')
          .eq('company_id', companyId)
          .maybeSingle(),
        supabase
          .from('sales')
          .select('customer_id, total, sold_at')
          .eq('company_id', companyId)
          .eq('status', 'active')
          .not('customer_id', 'is', null)
          .order('sold_at', { ascending: false })
          .limit(10000),
      ])

      if (customerResult.error) throw customerResult.error
      if (procureResult.error) throw procureResult.error
      if (categoryResult.error) throw categoryResult.error
      if (settingsResult.error) throw settingsResult.error
      if (salesResult.error) throw salesResult.error

      setCustomers(customerResult.data)
      setProcurations(procureResult.data)
      setCategories(categoryResult.data)
      setSettings(settingsResult.data)
      setSalesSummaryTruncated(salesResult.data.length >= 10000)
      const summary = new Map<string, PurchaseSummary>()
      salesResult.data.forEach((sale) => {
        if (!sale.customer_id) return
        const current = summary.get(sale.customer_id) ?? { count: 0, total: 0, lastSaleAt: null }
        current.count += 1
        current.total = roundCurrency(current.total + sale.total)
        if (!current.lastSaleAt || sale.sold_at > current.lastSaleAt) current.lastSaleAt = sale.sold_at
        summary.set(sale.customer_id, current)
      })
      setSalesSummary(summary)
    } catch (loadError) {
      setError(`Não foi possível carregar o CRM: ${errorText(loadError)}`)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!detailId || !supabase) {
      setNotes([])
      setContacts([])
      setCustomerSales([])
      setCustomerSaleItemsTruncated(false)
      return
    }

    let active = true
    setDetailLoading(true)
    setError('')
    void Promise.all([
      supabase
        .from('customer_notes')
        .select('*')
        .eq('company_id', companyId)
        .eq('customer_id', detailId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('customer_contacts')
        .select('*')
        .eq('company_id', companyId)
        .eq('customer_id', detailId)
        .order('contacted_at', { ascending: false })
        .limit(200),
      loadCustomerSaleHistory(companyId, detailId),
    ]).then(([notesResult, contactsResult, salesHistory]) => {
      if (!active) return
      if (notesResult.error) throw notesResult.error
      if (contactsResult.error) throw contactsResult.error
      setNotes(notesResult.data)
      setContacts(contactsResult.data)
      setCustomerSales(salesHistory.sales)
      setCustomerSaleItemsTruncated(salesHistory.itemsTruncated)
    }).catch((loadError: unknown) => {
      if (active) setError(`Não foi possível carregar a ficha do cliente: ${errorText(loadError)}`)
    }).finally(() => {
      if (active) setDetailLoading(false)
    })

    return () => {
      active = false
    }
  }, [companyId, detailId])

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  )

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return customers.filter((customer) => {
      if (customer.archived_at && !canManage) return false
      if (cityFilter && customer.city !== cityFilter) return false
      if (neighborhoodFilter && customer.neighborhood !== neighborhoodFilter) return false
      if (!query) return true
      const cpfQuery = cpfDigits(query)
      return customer.full_name.toLocaleLowerCase('pt-BR').includes(query)
        || (cpfQuery.length > 0 && (customer.cpf ?? '').includes(cpfQuery))
        || (customer.phone ?? '').toLocaleLowerCase('pt-BR').includes(query)
    })
  }, [canManage, cityFilter, customers, neighborhoodFilter, search])

  const uniqueCities = useMemo(
    () => [...new Set(customers.map((customer) => customer.city).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [customers],
  )
  const uniqueNeighborhoods = useMemo(
    () => [...new Set(customers.map((customer) => customer.neighborhood).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [customers],
  )
  const inactiveCustomers = useMemo(() => {
    const inactiveDays = settings?.inactive_days ?? defaultSettings.inactive_days
    const cutoff = Date.now() - inactiveDays * 86_400_000
    return customers.filter((customer) => {
      if (customer.archived_at) return false
      const lastSaleAt = salesSummary.get(customer.id)?.lastSaleAt
      return !lastSaleAt || new Date(lastSaleAt).getTime() < cutoff
    }).sort((a, b) => {
      const aLast = salesSummary.get(a.id)?.lastSaleAt
      const bLast = salesSummary.get(b.id)?.lastSaleAt
      return (aLast ?? '').localeCompare(bLast ?? '')
    })
  }, [customers, salesSummary, settings?.inactive_days])

  const openProcurations = useMemo(
    () => procurations.filter((procure) => procure.status === 'open'),
    [procurations],
  )

  const birthdays = useMemo(() => customers
    .filter((customer) => !customer.archived_at && customer.birth_date)
    .map((customer) => ({ customer, ...daysUntilBirthday(customer.birth_date as string) }))
    .filter((item) => birthdayRange === 'week' ? item.days <= 6 : new Date(`${item.customer.birth_date}T12:00:00`).getMonth() === new Date().getMonth())
    .sort((a, b) => a.days - b.days), [birthdayRange, customers])

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const formData = new FormData(event.currentTarget)
    const fullName = String(formData.get('fullName') ?? '').trim().replace(/\s+/g, ' ')
    const cpf = cpfDigits(String(formData.get('cpf') ?? ''))
    const phone = String(formData.get('phone') ?? '').trim()
    const birthDate = String(formData.get('birthDate') ?? '') || null
    const street = String(formData.get('street') ?? '').trim()
    const addressNumber = String(formData.get('addressNumber') ?? '').trim()
    const neighborhood = String(formData.get('neighborhood') ?? '').trim()
    const city = String(formData.get('city') ?? '').trim()
    const observations = String(formData.get('observations') ?? '').trim()
    const customFieldsText = String(formData.get('customFields') ?? '').trim() || '{}'
    let customFields: Record<string, unknown>

    if (!fullName || fullName.length > 180) {
      setError('Informe o nome do cliente (até 180 caracteres).')
      return
    }
    if (!isCpfFormatValid(cpf)) {
      setError('O CPF deve ter no máximo 20 dígitos.')
      return
    }
    if (cpf && !isValidCpf(cpf) && !window.confirm('O CPF informado parece inválido. Deseja salvar mesmo assim?')) return
    if (birthDate && (birthDate < '1900-01-01' || birthDate > new Date().toLocaleDateString('sv-SE'))) {
      setError('A data de nascimento deve estar entre 01/01/1900 e hoje.')
      return
    }
    try {
      const parsed = JSON.parse(customFieldsText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Os campos personalizados precisam ser um objeto JSON.')
      }
      customFields = parsed as Record<string, unknown>
    } catch (parseError) {
      setError(`JSON de campos personalizados inválido: ${errorText(parseError)}`)
      return
    }

    const titleCase = (value: string) => value.toLocaleLowerCase('pt-BR').replace(/(^|[\s'-])([a-zà-ÿ])/g, (_match, prefix: string, letter: string) => prefix + letter.toLocaleUpperCase('pt-BR'))
    const customerData = {
      full_name: fullName,
      cpf: cpf || null,
      phone: phone || null,
      birth_date: birthDate,
      street: street || null,
      address_number: addressNumber || null,
      neighborhood: neighborhood ? titleCase(neighborhood) : null,
      city: city ? titleCase(city) : null,
      observations,
      custom_fields: customFields,
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (customerFormId && customerFormId !== 'new') {
        const { data: updated, error: updateError } = await supabase
          .from('customers')
          .update(customerData)
          .eq('company_id', companyId)
          .eq('id', customerFormId)
          .select('id')
          .maybeSingle()
        if (updateError?.code === '23505') throw new Error('Já existe um cliente com este CPF nesta empresa.')
        if (updateError) throw updateError
        if (!updated) throw new Error('Cliente não encontrado ou sem permissão para alterá-lo.')
      } else {
        const { error: insertError } = await supabase.from('customers').insert({
          ...customerData,
          company_id: companyId,
          created_by: userId,
        })
        if (insertError?.code === '23505') throw new Error('Já existe um cliente com este CPF nesta empresa.')
        if (insertError) throw insertError
      }

      setCustomerFormId(null)
      setNotice(customerFormId && customerFormId !== 'new' ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      await loadData()
    } catch (saveError) {
      setError(`Não foi possível salvar o cliente: ${errorText(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !detailId) return

    const formData = new FormData(event.currentTarget)
    const content = String(formData.get('content') ?? '').trim()
    const attendedBy = String(formData.get('attendedBy') ?? '').trim()
    if (!content) {
      setError('Escreva o conteúdo da anotação.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (noteFormId) {
        const { data: updated, error: updateError } = await supabase
          .from('customer_notes')
          .update({ content, attended_by: attendedBy })
          .eq('company_id', companyId)
          .eq('customer_id', detailId)
          .eq('id', noteFormId)
          .select('id')
          .maybeSingle()
        if (updateError) throw updateError
        if (!updated) throw new Error('Anotação não encontrada ou não autorizada.')
      } else {
        const { error: insertError } = await supabase.from('customer_notes').insert({
          company_id: companyId,
          customer_id: detailId,
          content,
          attended_by: attendedBy,
          created_by: userId,
        })
        if (insertError) throw insertError
      }

      setNoteFormId(null)
      setNotice(noteFormId ? 'Anotação atualizada.' : 'Anotação registrada.')
      await reloadDetails()
    } catch (saveError) {
      setError(`Não foi possível salvar a anotação: ${errorText(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(note: CustomerNote) {
    if (!supabase || !canManage || !detailId) return
    if (!window.confirm('Excluir esta anotação?')) return

    setSaving(true)
    setError('')
    try {
      const { error: deleteError } = await supabase
        .from('customer_notes')
        .delete()
        .eq('company_id', companyId)
        .eq('customer_id', detailId)
        .eq('id', note.id)
      if (deleteError) throw deleteError
      setNotice('Anotação excluída.')
      await reloadDetails()
    } catch (deleteError) {
      setError(`Não foi possível excluir a anotação: ${errorText(deleteError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveProcure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const formData = new FormData(event.currentTarget)
    const customerId = String(formData.get('customerId') ?? '')
    const description = String(formData.get('description') ?? '').trim()
    const categoryId = String(formData.get('categoryId') ?? '') || null
    const details = String(formData.get('details') ?? '').trim()
    const status = String(formData.get('status') ?? 'open') as CustomerProcure['status']
    const occurredOn = String(formData.get('occurredOn') ?? '')
    if (!customerById.has(customerId)) {
      setError('Selecione um cliente ativo.')
      return
    }
    if (!description || description.length > 300) {
      setError('Descreva o item procurado (até 300 caracteres).')
      return
    }
    if (!['open', 'fulfilled', 'abandoned'].includes(status)) {
      setError('Selecione um status válido.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const procureData = {
        customer_id: customerId,
        category_id: categoryId,
        description,
        details,
        status,
        occurred_on: occurredOn || new Date().toLocaleDateString('sv-SE'),
        resolved_at: status === 'open' ? null : new Date().toISOString(),
      }

      if (procureFormId) {
        const { data: updated, error: updateError } = await supabase
          .from('customer_procurations')
          .update(procureData)
          .eq('company_id', companyId)
          .eq('id', procureFormId)
          .select('id')
          .maybeSingle()
        if (updateError) throw updateError
        if (!updated) throw new Error('Registro não encontrado ou não autorizado.')
      } else {
        const { error: insertError } = await supabase.from('customer_procurations').insert({
          ...procureData,
          company_id: companyId,
          created_by: userId,
        })
        if (insertError) throw insertError
      }

      setProcureFormId(null)
      setNotice(procureFormId ? 'Procura atualizada.' : 'Procura registrada.')
      await loadData()
      if (detailId) await reloadDetails()
    } catch (saveError) {
      setError(`Não foi possível salvar a procura: ${errorText(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function deleteProcure(procure: CustomerProcure) {
    if (!supabase || !canManage) return
    if (!window.confirm('Excluir este registro de procura?')) return
    setSaving(true)
    setError('')
    try {
      const { error: deleteError } = await supabase
        .from('customer_procurations')
        .delete()
        .eq('company_id', companyId)
        .eq('id', procure.id)
      if (deleteError) throw deleteError
      setNotice('Registro de procura excluído.')
      await loadData()
    } catch (deleteError) {
      setError(`Não foi possível excluir o registro: ${errorText(deleteError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function archiveCustomer(customer: Customer) {
    if (!supabase || !canManage) return
    const archived = !customer.archived_at
    if (archived && !window.confirm('Arquivar este cliente? A ficha e o histórico serão preservados.')) return

    setSaving(true)
    setError('')
    try {
      const { error: archiveError } = await supabase.rpc('set_customer_archived', {
        p_company_id: companyId,
        p_customer_id: customer.id,
        p_archived: archived,
      })
      if (archiveError) throw archiveError
      if (detailId === customer.id && archived) setDetailId(null)
      setNotice(archived ? 'Cliente arquivado; o histórico foi preservado.' : 'Cliente reativado.')
      await loadData()
    } catch (archiveError) {
      setError(`Não foi possível atualizar o cliente: ${errorText(archiveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function recordContact(customer: Customer, context: CustomerContact['context']) {
    if (!supabase) return
    const { error: contactError } = await supabase.rpc('record_customer_contact', {
      p_company_id: companyId,
      p_customer_id: customer.id,
      p_context: context,
    })
    if (contactError) {
      setError(`A conversa foi aberta, mas não foi possível registrar o contato: ${errorText(contactError)}`)
      return
    }
    setNotice('Contato registrado.')
    await loadData()
    if (detailId === customer.id) await reloadDetails()
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !canManage) return
    const formData = new FormData(event.currentTarget)
    const inactiveDays = Number(formData.get('inactiveDays'))
    if (!Number.isInteger(inactiveDays) || inactiveDays < 1 || inactiveDays > 3650) {
      setError('O período para clientes inativos deve estar entre 1 e 3650 dias.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const settingsData = {
        inactive_days: inactiveDays,
        whatsapp_message: String(formData.get('whatsappMessage') ?? '').trim(),
        birthday_message: String(formData.get('birthdayMessage') ?? '').trim(),
        procure_message: String(formData.get('procureMessage') ?? '').trim(),
      }
      const { data: updated, error: updateError } = await supabase
        .from('customer_settings')
        .update(settingsData)
        .eq('company_id', companyId)
        .select('*')
        .maybeSingle()
      if (updateError) throw updateError
      if (!updated) throw new Error('Configuração não encontrada ou sem permissão para alterá-la.')
      setSettings(updated)
      setSettingsOpen(false)
      setNotice('Preferências do CRM salvas.')
    } catch (saveError) {
      setError(`Não foi possível salvar as preferências: ${errorText(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function reloadDetails() {
    if (!supabase || !detailId) return
    const customerId = detailId
    setDetailLoading(true)
    try {
      const [notesResult, contactsResult, salesHistory] = await Promise.all([
        supabase
          .from('customer_notes')
          .select('*')
          .eq('company_id', companyId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('customer_contacts')
          .select('*')
          .eq('company_id', companyId)
          .eq('customer_id', customerId)
          .order('contacted_at', { ascending: false })
          .limit(200),
        loadCustomerSaleHistory(companyId, customerId),
      ])
      if (notesResult.error) throw notesResult.error
      if (contactsResult.error) throw contactsResult.error
      setNotes(notesResult.data)
      setContacts(contactsResult.data)
      setCustomerSales(salesHistory.sales)
      setCustomerSaleItemsTruncated(salesHistory.itemsTruncated)
    } catch (loadError) {
      setError(`Não foi possível atualizar a ficha: ${errorText(loadError)}`)
    } finally {
      setDetailLoading(false)
    }
  }

  function messageFor(customer: Customer, template: string, procure = ''): string {
    return template
      .replace(/\{nome\}/g, customer.full_name)
      .replace(/\{primeiro_nome\}/g, customer.full_name.split(' ')[0] ?? '')
      .replace(/\{loja\}/g, companyName)
      .replace(/\{procura\}/g, procure)
      .replace(/\{ultimo_item\}/g, '')
  }

  function whatsappUrl(customer: Customer, template: string, procure = ''): string | null {
    const digits = (customer.phone ?? '').replace(/\D/g, '')
    if (!digits) return null
    const phone = digits.length <= 11 ? `55${digits}` : digits
    return `https://wa.me/${phone}?text=${encodeURIComponent(messageFor(customer, template, procure))}`
  }

  function customerWhatsApp(customer: Customer, context: CustomerContact['context'], template: string, procure = '') {
    const href = whatsappUrl(customer, template, procure)
    if (!href) return <span className="customer-muted">Sem telefone cadastrado</span>
    return (
      <a
        className="whatsapp-link"
        href={href}
        onClick={() => void recordContact(customer, context)}
        rel="noopener noreferrer"
        target="_blank"
      >
        WhatsApp
      </a>
    )
  }

  function openCustomer(customerId: string) {
    setDetailId(customerId)
    setDetailTab('profile')
    setCustomerFormId(null)
    setTab('customers')
  }

  function customerForm(customerId: string | null) {
    const customer = customerId && customerId !== 'new' ? customerById.get(customerId) : undefined
    const customFields = JSON.stringify(customer?.custom_fields ?? {}, null, 2)

    return (
      <form className="customer-form" onSubmit={(event) => void saveCustomer(event)}>
        <div className="customer-form-title">
          <div><span className="eyebrow">{customer ? 'ATUALIZAÇÃO DE CADASTRO' : 'NOVO CADASTRO'}</span><h3>{customer ? 'Editar cliente' : 'Novo cliente'}</h3></div>
          <button className="customer-quiet-button" onClick={() => setCustomerFormId(null)} type="button">Fechar</button>
        </div>
        <div className="customer-form-grid">
          <label>Nome completo *<input autoComplete="name" defaultValue={customer?.full_name ?? ''} maxLength={180} name="fullName" required /></label>
          <label>CPF<input autoComplete="off" defaultValue={formatCpf(customer?.cpf ?? '')} inputMode="numeric" maxLength={23} name="cpf" /></label>
          <label>Telefone / WhatsApp<input autoComplete="tel" defaultValue={customer?.phone ?? ''} maxLength={40} name="phone" /></label>
          <label>Data de nascimento<input defaultValue={customer?.birth_date ?? ''} max="9999-12-31" min="1900-01-01" name="birthDate" type="date" /></label>
          <label className="customer-wide-field">Rua<input autoComplete="address-line1" defaultValue={customer?.street ?? ''} maxLength={180} name="street" /></label>
          <label>Número<input defaultValue={customer?.address_number ?? ''} maxLength={40} name="addressNumber" /></label>
          <label>Bairro<input autoComplete="address-level3" defaultValue={customer?.neighborhood ?? ''} maxLength={120} name="neighborhood" /></label>
          <label>Cidade<input autoComplete="address-level2" defaultValue={customer?.city ?? ''} maxLength={120} name="city" /></label>
          <label className="customer-wide-field">Observações<textarea defaultValue={customer?.observations ?? ''} maxLength={4000} name="observations" rows={3} /></label>
          <label className="customer-wide-field">Campos personalizados (JSON)
            <textarea defaultValue={customFields} name="customFields" rows={4} spellCheck={false} />
            <small>Preserva os campos customizados configurados na versão atual.</small>
          </label>
        </div>
        <div className="customer-form-actions">
          <button className="customer-quiet-button" onClick={() => setCustomerFormId(null)} type="button">Cancelar</button>
          <button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar cliente'}</button>
        </div>
      </form>
    )
  }

  const selectedCustomer = detailId ? customerById.get(detailId) : undefined
  const effectiveSettings = settings ?? defaultSettings
  const customerTabs: { id: CustomerTab; label: string }[] = [
    { id: 'customers', label: 'Clientes' },
    { id: 'inactive', label: `Inativos${inactiveCustomers.length ? ` (${inactiveCustomers.length})` : ''}` },
    { id: 'procurations', label: `Procurados${openProcurations.length ? ` (${openProcurations.length})` : ''}` },
    { id: 'birthdays', label: 'Aniversariantes' },
    ...(canManage ? [{ id: 'settings' as const, label: 'Preferências' }] : []),
  ]

  return (
    <section className="customers-module">
      <div className="section-heading customers-heading">
        <div><span className="eyebrow">MÓDULO 2 · CRM</span><h2>Clientes e relacionamento</h2></div>
        <span className="step-count">{customers.filter((customer) => !customer.archived_at).length} cliente(s)</span>
      </div>

      {error && <p className="form-alert error customer-alert" role="alert">{error}</p>}
      {notice && <p className="form-alert success customer-alert" role="status">{notice}</p>}

      {!detailId && (
        <div className="customer-tabs" role="tablist" aria-label="Seções do CRM">
          {customerTabs.map((item) => (
            <button aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">
              {item.label}
            </button>
          ))}
        </div>
      )}

      {loading ? <p className="customer-empty" role="status">Carregando clientes…</p> : null}
      {!loading && customers.length >= 1000 && (
        <p className="customer-hint">Esta tela carrega até 1.000 clientes por vez; há ferramentas de busca para localizar um cadastro nessa lista.</p>
      )}
      {!loading && salesSummaryTruncated && <p className="customer-hint">O resumo de compras foi limitado a 10.000 vendas ativas. Use a ficha individual para consultar as vendas mais recentes de um cliente.</p>}

      {!loading && detailId && selectedCustomer && (
        <section className="customer-detail">
          <div className="customer-detail-top">
            <button className="customer-quiet-button" onClick={() => { setDetailId(null); setDetailTab('profile') }} type="button">← Voltar à lista</button>
            <div className="customer-detail-actions">
              {customerWhatsApp(selectedCustomer, 'general', effectiveSettings.whatsapp_message)}
              {canManage && <button className="customer-quiet-button" onClick={() => setCustomerFormId(selectedCustomer.id)} type="button">Editar cadastro</button>}
              {canManage && <button className="customer-quiet-button" onClick={() => void archiveCustomer(selectedCustomer)} type="button">{selectedCustomer.archived_at ? 'Reativar' : 'Arquivar'}</button>}
            </div>
          </div>
          {customerFormId && customerFormId === selectedCustomer.id && customerForm(customerFormId)}
          <div className="customer-profile-card">
            <div>
              <span className="eyebrow">{selectedCustomer.archived_at ? 'CLIENTE ARQUIVADO' : 'FICHA DO CLIENTE'}</span>
              <h3>{selectedCustomer.full_name}</h3>
              <p>{[selectedCustomer.phone, selectedCustomer.cpf ? formatCpf(selectedCustomer.cpf) : null].filter(Boolean).join(' · ') || 'Sem telefone ou CPF'}</p>
              <small>Cliente desde {new Date(selectedCustomer.created_at).toLocaleDateString('pt-BR')}{selectedCustomer.last_contact_at ? ` · último contato ${new Date(selectedCustomer.last_contact_at).toLocaleString('pt-BR')}` : ''}</small>
            </div>
            <div className="customer-address">
              {[selectedCustomer.street && [selectedCustomer.street, selectedCustomer.address_number].filter(Boolean).join(', '), selectedCustomer.neighborhood, selectedCustomer.city].filter(Boolean).join(' · ') || 'Endereço não informado'}
            </div>
          </div>
          <div className="customer-tabs customer-detail-tabs" role="tablist" aria-label="Ficha do cliente">
            {([
              ['profile', 'Dados'],
              ['notes', `Anotações (${notes.length})`],
              ['procurations', `Procuras (${procurations.filter((item) => item.customer_id === selectedCustomer.id && item.status === 'open').length})`],
              ['contacts', `Contatos (${contacts.length})`],
            ] as const).map(([id, label]) => (
              <button aria-selected={detailTab === id} className={detailTab === id ? 'selected' : ''} key={id} onClick={() => setDetailTab(id)} role="tab" type="button">{label}</button>
            ))}
          </div>
          {detailLoading ? <p className="customer-empty" role="status">Carregando ficha…</p> : null}
          {!detailLoading && detailTab === 'profile' && (
            <div className="customer-profile-grid">
              <article><span>CPF</span><strong>{selectedCustomer.cpf ? formatCpf(selectedCustomer.cpf) : '—'}</strong></article>
              <article><span>Telefone</span><strong>{selectedCustomer.phone || '—'}</strong></article>
              <article><span>Nascimento</span><strong>{selectedCustomer.birth_date ? new Date(`${selectedCustomer.birth_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</strong></article>
              <article><span>Observações</span><strong>{selectedCustomer.observations || '—'}</strong></article>
              {Object.entries(selectedCustomer.custom_fields).map(([key, value]) => (
                <article key={key}><span>{key}</span><strong>{typeof value === 'string' ? value : JSON.stringify(value)}</strong></article>
              ))}
              <div className="customer-pending-panel customer-purchases">
                <strong>Histórico de compras</strong>
                <span>{salesSummary.get(selectedCustomer.id)?.count ?? 0} venda(s) ativa(s) · total comprado {money(salesSummary.get(selectedCustomer.id)?.total ?? 0)}{salesSummary.get(selectedCustomer.id)?.lastSaleAt ? ` · última compra ${new Date(salesSummary.get(selectedCustomer.id)?.lastSaleAt ?? '').toLocaleDateString('pt-BR')}` : ' · nenhuma compra registrada'}</span>
                {customerSales.length ? customerSales.map((sale) => (
                  <div className="customer-purchase-row" key={sale.id}>
                    <span><strong>Venda #{sale.sale_number}</strong> · {new Date(sale.sold_at).toLocaleString('pt-BR')} · {sale.status === 'active' ? 'Ativa' : 'Cancelada'}</span>
                    <span>{sale.items.map((item) => `${item.quantity}× ${item.product_name}`).join(', ') || 'Itens indisponíveis'}</span>
                    <strong>{money(sale.total)}</strong>
                  </div>
                )) : <small>Nenhuma venda associada a este cliente.</small>}
                {customerSales.length >= 200 && <small>Exibindo as 200 vendas mais recentes.</small>}
                {customerSaleItemsTruncated && <small>Os itens do histórico foram limitados a 2.000 registros.</small>}
              </div>
            </div>
          )}
          {!detailLoading && detailTab === 'notes' && (
            <div className="customer-card">
              <form className="customer-note-form" onSubmit={(event) => void saveNote(event)}>
                <label>Nova anotação<textarea defaultValue={noteFormId ? notes.find((item) => item.id === noteFormId)?.content ?? '' : ''} maxLength={4000} name="content" placeholder="Preferências, tamanho, pedido de retorno…" required rows={3} /></label>
                <div className="customer-form-actions">
                  <label>Atendido por (opcional)<input defaultValue={noteFormId ? notes.find((item) => item.id === noteFormId)?.attended_by ?? '' : ''} maxLength={120} name="attendedBy" /></label>
                  {noteFormId && <button className="customer-quiet-button" onClick={() => setNoteFormId(null)} type="button">Cancelar edição</button>}
                  <button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : noteFormId ? 'Atualizar anotação' : 'Salvar anotação'}</button>
                </div>
              </form>
              {!notes.length ? <p className="customer-empty">Nenhuma anotação registrada.</p> : notes.map((note) => (
                <article className="customer-note" key={note.id}>
                  <div className="customer-note-meta">
                    <span>{new Date(note.created_at).toLocaleString('pt-BR')}{note.attended_by ? ` · ${note.attended_by}` : ''}</span>
                    <div>
                      <button className="customer-quiet-button small" onClick={() => setNoteFormId(note.id)} type="button">Editar</button>
                      {canManage && <button className="customer-quiet-button small danger" onClick={() => void deleteNote(note)} type="button">Excluir</button>}
                    </div>
                  </div>
                  <p>{note.content}</p>
                </article>
              ))}
            </div>
          )}
          {!detailLoading && detailTab === 'procurations' && (
            <div className="customer-card">
              <div className="customer-list-heading"><p>Itens que este cliente procurou e não encontrou.</p><button className="customer-primary-button" onClick={() => setProcureFormId('new')} type="button">+ Registrar procura</button></div>
              {procureFormId && <ProcureForm
                categories={categories}
                customer={selectedCustomer}
                customers={customers.filter((item) => !item.archived_at)}
                initial={procureFormId === 'new' ? null : procurations.find((item) => item.id === procureFormId) ?? null}
                saving={saving}
                onCancel={() => setProcureFormId(null)}
                onSubmit={saveProcure}
              />}
              {procurations.filter((item) => item.customer_id === selectedCustomer.id).length === 0
                ? <p className="customer-empty">Nenhuma procura registrada.</p>
                : procurations.filter((item) => item.customer_id === selectedCustomer.id).map((procure) => (
                  <ProcureRow
                    categories={categories}
                    customer={selectedCustomer}
                    key={procure.id}
                    onDelete={() => void deleteProcure(procure)}
                    onEdit={() => setProcureFormId(procure.id)}
                    onStatus={async (status) => {
                      if (!supabase) return
                      const { error: statusError } = await supabase
                        .from('customer_procurations')
                        .update({ status, resolved_at: status === 'open' ? null : new Date().toISOString() })
                        .eq('company_id', companyId)
                        .eq('id', procure.id)
                      if (statusError) setError(`Não foi possível atualizar o status: ${errorText(statusError)}`)
                      else {
                        setNotice(`Procura marcada como ${statusLabels[status].toLocaleLowerCase('pt-BR')}.`)
                        await loadData()
                      }
                    }}
                    onWhatsApp={() => customerWhatsApp(selectedCustomer, 'procure', effectiveSettings.procure_message, procure.description)}
                    procure={procure}
                    role={role}
                  />
                ))}
            </div>
          )}
          {!detailLoading && detailTab === 'contacts' && (
            <div className="customer-card">
              {contacts.length ? contacts.map((contact) => (
                <article className="customer-note" key={contact.id}>
                  <div className="customer-note-meta"><span>{new Date(contact.contacted_at).toLocaleString('pt-BR')}</span><span>{contact.channel === 'whatsapp' ? 'WhatsApp' : contact.channel} · {contact.context}</span></div>
                </article>
              )) : <p className="customer-empty">Nenhum contato registrado.</p>}
            </div>
          )}
        </section>
      )}

      {!loading && detailId && !selectedCustomer && (
        <div className="customer-card"><p className="customer-empty">Cliente não encontrado nesta empresa.</p><button className="customer-quiet-button" onClick={() => setDetailId(null)} type="button">Voltar</button></div>
      )}

      {!loading && !detailId && tab === 'customers' && (
        <>
          <div className="customer-metrics">
            <article><span>Clientes cadastrados</span><strong>{customers.filter((customer) => !customer.archived_at).length}</strong></article>
            <article><span>Procuras em aberto</span><strong>{openProcurations.length}</strong></article>
            <article><span>Aniversariantes próximos 7 dias</span><strong>{customers.filter((customer) => customer.birth_date && !customer.archived_at && daysUntilBirthday(customer.birth_date).days <= 6).length}</strong></article>
          </div>
          <div className="customer-card">
            <div className="customer-toolbar">
              <input aria-label="Buscar nome, CPF ou telefone" onChange={(event) => setSearch(event.target.value)} placeholder="Nome, CPF ou telefone…" type="search" value={search} />
              <select aria-label="Filtrar por cidade" onChange={(event) => setCityFilter(event.target.value)} value={cityFilter}>
                <option value="">Todas as cidades</option>{uniqueCities.map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
              <select aria-label="Filtrar por bairro" onChange={(event) => setNeighborhoodFilter(event.target.value)} value={neighborhoodFilter}>
                <option value="">Todos os bairros</option>{uniqueNeighborhoods.map((neighborhood) => <option key={neighborhood} value={neighborhood}>{neighborhood}</option>)}
              </select>
              {canManage && <button className="customer-primary-button" onClick={() => setCustomerFormId('new')} type="button">+ Cliente</button>}
            </div>
            {customerFormId && (customerFormId === 'new' || !detailId) && customerForm(customerFormId)}
            {filteredCustomers.length ? (
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th>Cidade / bairro</th><th>Última compra</th><th>Último contato</th><th /></tr></thead>
                  <tbody>{filteredCustomers.map((customer) => (
                    <tr className={customer.archived_at ? 'customer-archived' : ''} key={customer.id}>
                      <td><button className="customer-name-button" onClick={() => openCustomer(customer.id)} type="button">{customer.full_name}</button>{customer.archived_at && <small>Arquivado</small>}</td>
                      <td>{customer.cpf ? formatCpf(customer.cpf) : '—'}</td>
                      <td>{customer.phone || '—'}</td>
                      <td>{[customer.city, customer.neighborhood].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{salesSummary.get(customer.id)?.lastSaleAt ? new Date(salesSummary.get(customer.id)?.lastSaleAt ?? '').toLocaleDateString('pt-BR') : 'Nunca'}</td>
                      <td>{customer.last_contact_at ? new Date(customer.last_contact_at).toLocaleDateString('pt-BR') : '—'}</td>
                      <td className="customer-row-actions">
                        {customerWhatsApp(customer, 'general', effectiveSettings.whatsapp_message)}
                        <button className="customer-quiet-button small" onClick={() => openCustomer(customer.id)} type="button">Ficha</button>
                        {canManage && <button className="customer-quiet-button small" onClick={() => void archiveCustomer(customer)} type="button">{customer.archived_at ? 'Reativar' : 'Arquivar'}</button>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="customer-empty">{customers.length ? 'Nenhum cliente encontrado com esses filtros.' : 'Ainda não há clientes cadastrados.'}</p>}
          </div>
        </>
      )}

      {!loading && !detailId && tab === 'inactive' && (
        <div className="customer-card">
          <div className="customer-list-heading">
            <div><h3>Clientes sem compra recente</h3><p>Inatividade definida como nenhuma venda ou última compra há mais de {effectiveSettings.inactive_days} dia(s).</p></div>
          </div>
          {inactiveCustomers.length ? (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead><tr><th>Cliente</th><th>Última compra</th><th>Vendas</th><th>Total comprado</th><th>WhatsApp</th></tr></thead>
                <tbody>{inactiveCustomers.map((customer) => {
                  const summary = salesSummary.get(customer.id)
                  return (
                    <tr key={customer.id}>
                      <td><button className="customer-name-button" onClick={() => openCustomer(customer.id)} type="button">{customer.full_name}</button><small>{customer.phone || 'Sem telefone'}</small></td>
                      <td>{summary?.lastSaleAt ? new Date(summary.lastSaleAt).toLocaleDateString('pt-BR') : 'Nunca comprou'}</td>
                      <td>{summary?.count ?? 0}</td>
                      <td>{money(summary?.total ?? 0)}</td>
                      <td>{customerWhatsApp(customer, 'reactivation', effectiveSettings.whatsapp_message)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          ) : <p className="customer-empty">Nenhum cliente está acima do limite de inatividade configurado.</p>}
        </div>
      )}

      {!loading && !detailId && tab === 'procurations' && (
        <div className="customer-card">
          <div className="customer-list-heading">
            <div><h3>O que os clientes estão procurando</h3><p>Use esta lista para planejar compras e avisar quando um item chegar.</p></div>
            <button className="customer-primary-button" onClick={() => setProcureFormId('new')} type="button">+ Registrar procura</button>
          </div>
          <div className="customer-toolbar">
            <select aria-label="Filtrar status das procuras" onChange={(event) => setProcurationFilter(event.target.value as 'open' | 'all')} value={procurationFilter}>
              <option value="open">Somente em aberto</option><option value="all">Todos os status</option>
            </select>
          </div>
          {procureFormId && <ProcureForm
            categories={categories}
            customer={undefined}
            customers={customers.filter((item) => !item.archived_at)}
            initial={procureFormId === 'new' ? null : procurations.find((item) => item.id === procureFormId) ?? null}
            saving={saving}
            onCancel={() => setProcureFormId(null)}
            onSubmit={saveProcure}
          />}
          {procurations.filter((item) => procurationFilter === 'all' || item.status === 'open').length ? (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead><tr><th>Data</th><th>Cliente</th><th>Item procurado</th><th>Classificação</th><th>Status</th><th /></tr></thead>
                <tbody>{procurations.filter((item) => procurationFilter === 'all' || item.status === 'open').map((procure) => {
                  const customer = customerById.get(procure.customer_id)
                  if (!customer) return null
                  return (
                    <tr className={procure.status !== 'open' ? 'customer-archived' : ''} key={procure.id}>
                      <td>{new Date(`${procure.occurred_on}T12:00:00`).toLocaleDateString('pt-BR')}</td>
                      <td><button className="customer-name-button" onClick={() => openCustomer(customer.id)} type="button">{customer.full_name}</button></td>
                      <td><strong>{procure.description}</strong>{procure.details && <small>{procure.details}</small>}</td>
                      <td>{categories.find((category) => category.id === procure.category_id)?.name ?? '—'}</td>
                      <td><span className={`procure-status ${procure.status}`}>{statusLabels[procure.status]}</span></td>
                      <td className="customer-row-actions">
                        {procure.status === 'open' && customerWhatsApp(customer, 'procure', effectiveSettings.procure_message, procure.description)}
                        <button className="customer-quiet-button small" onClick={() => setProcureFormId(procure.id)} type="button">Editar</button>
                        {canManage && <button className="customer-quiet-button small danger" onClick={() => void deleteProcure(procure)} type="button">Excluir</button>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          ) : <p className="customer-empty">Nenhuma procura em aberto neste momento.</p>}
          <p className="customer-hint">As mensagens usam {`{nome}, {primeiro_nome}, {loja} e {procura}`} como variáveis.</p>
        </div>
      )}

      {!loading && !detailId && tab === 'birthdays' && (
        <div className="customer-card">
          <div className="customer-list-heading">
            <div><h3>Aniversariantes</h3><p>Próximas datas com base nos cadastros ativos.</p></div>
            <select aria-label="Período dos aniversariantes" onChange={(event) => setBirthdayRange(event.target.value as BirthdayRange)} value={birthdayRange}>
              <option value="week">Próximos 7 dias</option><option value="month">Este mês</option>
            </select>
          </div>
          {birthdays.length ? (
            <div className="customer-table-wrap">
              <table className="customer-table">
                <thead><tr><th>Cliente</th><th>Aniversário</th><th>Faz</th><th>Telefone</th><th /></tr></thead>
                <tbody>{birthdays.map(({ customer, days, age }) => (
                  <tr key={customer.id}>
                    <td><button className="customer-name-button" onClick={() => openCustomer(customer.id)} type="button">{customer.full_name}</button></td>
                    <td>{new Date(`${customer.birth_date}T12:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td>{age} anos{days === 0 ? ' · hoje' : days === 1 ? ' · amanhã' : ` · em ${days} dias`}</td>
                    <td>{customer.phone || '—'}</td>
                    <td>{customerWhatsApp(customer, 'birthday', effectiveSettings.birthday_message)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="customer-empty">Nenhum aniversariante no período. Complete as datas de nascimento nos cadastros.</p>}
        </div>
      )}

      {!loading && !detailId && tab === 'settings' && canManage && (
        <div className="customer-card">
          <h3>Preferências de relacionamento</h3>
          {settingsOpen ? (
            <form className="customer-settings-form" onSubmit={(event) => void saveSettings(event)}>
              <label>Considerar cliente inativo após (dias)<input defaultValue={effectiveSettings.inactive_days} max="3650" min="1" name="inactiveDays" required type="number" /></label>
              <label>Mensagem padrão de WhatsApp<textarea defaultValue={effectiveSettings.whatsapp_message} maxLength={2000} name="whatsappMessage" rows={3} /></label>
              <label>Mensagem de aniversário<textarea defaultValue={effectiveSettings.birthday_message} maxLength={2000} name="birthdayMessage" rows={3} /></label>
              <label>Mensagem de aviso de item procurado<textarea defaultValue={effectiveSettings.procure_message} maxLength={2000} name="procureMessage" rows={3} /></label>
              <p className="customer-hint">Variáveis disponíveis: {`{nome}, {primeiro_nome}, {loja}, {procura}, {ultimo_item}`}. A integração abre o WhatsApp Web; não envia mensagens automaticamente.</p>
              <div className="customer-form-actions"><button className="customer-quiet-button" onClick={() => setSettingsOpen(false)} type="button">Cancelar</button><button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar preferências'}</button></div>
            </form>
          ) : (
            <div className="customer-settings-summary">
              <p>Clientes considerados inativos após <strong>{effectiveSettings.inactive_days} dias</strong>.</p>
              <p>As mensagens são personalizáveis com variáveis para nome, loja, último item e procura.</p>
              <button className="customer-primary-button" onClick={() => setSettingsOpen(true)} type="button">Editar preferências</button>
            </div>
          )}
          <div className="customer-pending-panel">
            <strong>Clientes inativos</strong>
            <span>A lista considera a última venda ativa e o período de inatividade configurado. O último item permanece disponível no histórico da ficha do cliente.</span>
          </div>
        </div>
      )}
    </section>
  )
}

type ProcureFormProps = {
  categories: CustomerCategory[]
  customers: Customer[]
  customer: Customer | undefined
  initial: CustomerProcure | null
  saving: boolean
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function ProcureForm({ categories, customers, customer, initial, saving, onCancel, onSubmit }: ProcureFormProps) {
  return (
    <form className="customer-form" onSubmit={onSubmit}>
      <div className="customer-form-title"><div><span className="eyebrow">CRM</span><h3>{initial ? 'Editar procura' : 'Registrar procura'}</h3></div><button className="customer-quiet-button" onClick={onCancel} type="button">Fechar</button></div>
      <div className="customer-form-grid">
        <label>Cliente *
          <select defaultValue={initial?.customer_id ?? customer?.id ?? ''} name="customerId" required>
            <option value="">Selecione…</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
          </select>
        </label>
        <label>O que procura *<input defaultValue={initial?.description ?? ''} maxLength={300} name="description" placeholder="Ex.: bermuda cargo preta" required /></label>
        <label>Classificação
          <select defaultValue={initial?.category_id ?? ''} name="categoryId"><option value="">—</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        </label>
        <label>Tamanho, cor ou detalhe<input defaultValue={initial?.details ?? ''} maxLength={500} name="details" /></label>
        <label>Status<select defaultValue={initial?.status ?? 'open'} name="status"><option value="open">Procurando</option><option value="fulfilled">Atendido</option><option value="abandoned">Desistiu</option></select></label>
        <label>Data<input defaultValue={initial?.occurred_on ?? new Date().toLocaleDateString('sv-SE')} name="occurredOn" type="date" /></label>
      </div>
      <div className="customer-form-actions"><button className="customer-quiet-button" onClick={onCancel} type="button">Cancelar</button><button className="customer-primary-button" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar procura'}</button></div>
    </form>
  )
}

type ProcureRowProps = {
  categories: CustomerCategory[]
  customer: Customer
  procure: CustomerProcure
  role: CompanyRole
  onEdit: () => void
  onDelete: () => void
  onStatus: (status: CustomerProcure['status']) => void
  onWhatsApp: () => React.ReactNode
}

function ProcureRow({ categories, customer, procure, role, onEdit, onDelete, onStatus, onWhatsApp }: ProcureRowProps) {
  return (
    <article className={`customer-procure-row${procure.status !== 'open' ? ' resolved' : ''}`}>
      <div><span className="eyebrow">{new Date(`${procure.occurred_on}T12:00:00`).toLocaleDateString('pt-BR')} · {customer.full_name}</span><h4>{procure.description}</h4>
        <p>{categories.find((category) => category.id === procure.category_id)?.name ?? 'Sem classificação'}{procure.details ? ` · ${procure.details}` : ''}</p>
      </div>
      <div className="customer-procure-actions">
        <select aria-label={`Status da procura ${procure.description}`} onChange={(event) => onStatus(event.target.value as CustomerProcure['status'])} value={procure.status}>
          <option value="open">Procurando</option><option value="fulfilled">Atendido</option><option value="abandoned">Desistiu</option>
        </select>
        {procure.status === 'open' && onWhatsApp()}
        <button className="customer-quiet-button small" onClick={onEdit} type="button">Editar</button>
        {role !== 'operator' && <button className="customer-quiet-button small danger" onClick={onDelete} type="button">Excluir</button>}
      </div>
    </article>
  )
}

export default Customers
