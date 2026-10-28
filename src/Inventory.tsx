import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { CompanyRole, Database } from './lib/database.types'
import { supabase } from './lib/supabase'

type Category = Database['public']['Tables']['product_categories']['Row']
type Product = Database['public']['Tables']['products']['Row']
type Movement = Database['public']['Tables']['stock_movements']['Row']
type InventoryTab = 'products' | 'movements'
type ProductStatus = 'active' | 'inactive' | 'all'
type MovementDraft = {
  id: string | null
  productId: string
  type: string
  direction: number
  quantity: string
  unitCost: string
  occurredAt: string
  observations: string
  updateProductCost: boolean
}

const movementTypes = [
  { type: 'Chegada de estoque', direction: 1 },
  { type: 'Devolução de cliente', direction: 1 },
  { type: 'Ajuste de entrada', direction: 1 },
  { type: 'Ajuste de saída', direction: -1 },
  { type: 'Perda / avaria', direction: -1 },
  { type: 'Estoque inicial', direction: 1 },
  { type: 'Ajuste (edição do cadastro)', direction: 0 },
]

const initialCatalog = [
  ['Camisas', [['Camisa Premium', 60, 3, 120], ['Camisa VVN Básica', 150], ['Camisa VVN Estampada', 160], ['Camisa Oversized', 120], ['Camisa Time Nacional', 80], ['Camisa Tailandesa', 150], ['Camisa Buzzfly', 160], ['Camisa Buzzfly Polo', 180], ['Camisa Plano C', 130]]],
  ['Shorts', [['Short Premium Rip Stop', 90], ['Short Premium Normal', 80], ['Bermuda VVN', 260], ['Bermuda Jeans Stonada', 130], ['Bermuda Bag Cargo Stonada', 140], ['Bermuda Jorts', 140], ['Bermuda Sarja', 100], ['Bermuda Plano C', 200], ['Bermuda de Linho', 120], ['Bermuda Fire', 170]]],
  ['Calças', [['Calça Stonada Cargo', 150], ['Calça Moletom', 120], ['Calça Denim&Co Tribal', 250], ['Calça Jogger', 120], ['Calça Jeans Skinny', 120], ['Calça Baggy', 120]]],
  ['Casacos', [['Moletom Capuz', 180], ['Moletom sem Capuz', 150], ['Moletom Plano C', 260], ['Conjunto de Frio (casaco + calça)', 350], ['Bobojaco', 250], ['Casaco VVN Zíper', 300], ['Casaco VVN Canguru', 300]]],
  ['Calçados', [['Tênis Premium', 200], ['Tênis Importado', 350], ['Sandália Mind Nike', 230], ['Sandália Asuna', 150], ['Sandália Turbo', 220], ['Sandália Slide Nuvem Nike', 120], ['Kenner Mega Plus', 150], ['Kenner Normal', 120], ['Tênis Double G', 0]]],
  ['Bonés', [['Boné Dry Fit', 70], ['Boné Grife', 100], ['Boné Grife LV Stonado', 100], ['Boné Normal', 50], ['Boné VVN', 250]]],
  ['Acessórios', [['Escapulário', 80], ['Brinco Cravejado', 30], ['Brinco Zircônia Quadrado 3mm', 8], ['Brinco Zircônia Quadrado 6mm', 12], ['Brinco Zircônia Redondo 6mm', 12], ['Shoulder Bag', 80], ['Cinto', 60], ['Relógio', 200], ['Meia', 40]]],
  ['Óculos', [['Óculos', 0]]],
  ['Perfumes e Cremes', [['Assad', 300], ['Salvo Elixir', 280], ['Angel', 130]]],
] as const

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
}

function toLocalDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function storeDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Não foi possível determinar a data da loja.')
  return `${year}-${month}-${day}`
}

function money(value: number | null): string {
  return value == null
    ? '—'
    : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | null {
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function movementDraftFor(productId: string, movement?: Movement): MovementDraft {
  const selectedType = movementTypes.find((item) => item.type === movement?.type)

  return {
    id: movement?.id ?? null,
    productId: movement?.product_id ?? productId,
    type: movement?.type ?? 'Chegada de estoque',
    direction: movement?.direction ?? 1,
    quantity: String(movement?.quantity ?? 1),
    unitCost: movement?.unit_cost == null ? '' : String(movement.unit_cost),
    occurredAt: toLocalDateTime(movement ? new Date(movement.occurred_at) : new Date()),
    observations: movement?.observations ?? '',
    updateProductCost: movement ? Boolean(selectedType) && movement.unit_cost != null : true,
  }
}

type InventoryProps = {
  companyId: string
  userId: string
  role: CompanyRole
}

function Inventory({ companyId, userId, role }: InventoryProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [tab, setTab] = useState<InventoryTab>('products')
  const [productStatus, setProductStatus] = useState<ProductStatus>('active')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [movementTypeFilter, setMovementTypeFilter] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [productFormId, setProductFormId] = useState<string | null>(null)
  const [movementForm, setMovementForm] = useState<MovementDraft | null>(null)
  const [categoryFormOpen, setCategoryFormOpen] = useState(false)
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
      const [categoryResult, productResult, movementResult] = await Promise.all([
        supabase
          .from('product_categories')
          .select('*')
          .eq('company_id', companyId)
          .order('sort_order')
          .order('name'),
        supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .order('name'),
        supabase
          .from('stock_movements')
          .select('*')
          .eq('company_id', companyId)
          .order('occurred_at', { ascending: false })
          .limit(500),
      ])

      if (categoryResult.error) throw categoryResult.error
      if (productResult.error) throw productResult.error
      if (movementResult.error) throw movementResult.error

      setCategories(categoryResult.data)
      setProducts(productResult.data)
      setMovements(movementResult.data)
    } catch (loadError) {
      setError(`Não foi possível carregar produtos e estoque: ${messageFrom(loadError)}`)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')

    return products.filter((product) => {
      const statusMatches =
        productStatus === 'all'
        || (productStatus === 'active' && product.active)
        || (productStatus === 'inactive' && !product.active)
      const categoryMatches = !categoryFilter || product.category_id === categoryFilter
      const queryMatches = !query
        || product.name.toLocaleLowerCase('pt-BR').includes(query)
        || (product.code ?? '').toLocaleLowerCase('pt-BR').includes(query)

      return statusMatches && categoryMatches && queryMatches
    })
  }, [categoryFilter, productStatus, products, search])

  const visibleMovements = useMemo(() => {
    const query = movementSearch.trim().toLocaleLowerCase('pt-BR')

    return movements.filter((movement) => {
      const product = productsById.get(movement.product_id)
      const typeMatches = !movementTypeFilter || movement.type === movementTypeFilter
      const queryMatches = !query || (product?.name ?? '').toLocaleLowerCase('pt-BR').includes(query)
      return typeMatches && queryMatches
    })
  }, [movementSearch, movementTypeFilter, movements, productsById])

  const stockTotals = useMemo(() => {
    const stock = visibleProducts.reduce((total, product) => total + product.current_stock, 0)
    const value = visibleProducts.reduce(
      (total, product) => total + Math.max(0, product.current_stock) * product.price,
      0,
    )
    return { stock, value }
  }, [visibleProducts])

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const form = event.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (!name) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { error: insertError } = await supabase.from('product_categories').insert({
        company_id: companyId,
        name,
        sort_order: categories.length + 1,
      })
      if (insertError?.code === '23505') {
        throw new Error('Já existe uma classificação com esse nome.')
      }
      if (insertError) throw insertError

      setCategoryFormOpen(false)
      setNotice('Classificação adicionada.')
      await loadData()
    } catch (saveError) {
      setError(`Não foi possível adicionar a classificação: ${messageFrom(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !canManage) return

    const form = event.currentTarget
    const values = new FormData(form)
    const name = String(values.get('name') ?? '').trim()
    const categoryId = String(values.get('categoryId') ?? '')
    const price = parseOptionalNumber(values.get('price'))
    const cost = parseOptionalNumber(values.get('cost'))
    const minimum = parseOptionalNumber(values.get('stockMin'))
    const maximum = parseOptionalNumber(values.get('stockMax'))
    const promotionQuantity = parseOptionalNumber(values.get('promotionQuantity'))
    const promotionPrice = parseOptionalNumber(values.get('promotionPrice'))
    const code = String(values.get('code') ?? '').trim()
    const observations = String(values.get('observations') ?? '').trim()
    const active = values.get('active') === 'on'

    if (!name || name.length > 180) {
      setError('Informe um nome de produto com até 180 caracteres.')
      return
    }
    if (!categoriesById.has(categoryId)) {
      setError('Selecione uma classificação válida.')
      return
    }
    if (price == null || Number.isNaN(price) || price < 0) {
      setError('Informe um preço de venda válido.')
      return
    }
    if (cost != null && (Number.isNaN(cost) || cost < 0)) {
      setError('O custo deve ser um valor maior ou igual a zero.')
      return
    }
    for (const [label, value] of [['Estoque mínimo', minimum], ['Estoque máximo', maximum]] as const) {
      if (value != null && (Number.isNaN(value) || !Number.isInteger(value) || value < 0)) {
        setError(`${label} deve ser uma quantidade inteira maior ou igual a zero.`)
        return
      }
    }
    if ((promotionQuantity == null) !== (promotionPrice == null)) {
      setError('Preencha quantidade e preço da promoção, ou deixe ambos vazios.')
      return
    }
    let promotion: { qtd: number; preco: number } | null = null
    if (promotionQuantity != null && promotionPrice != null) {
      if (
        Number.isNaN(promotionQuantity)
        || !Number.isInteger(promotionQuantity)
        || promotionQuantity < 2
        || Number.isNaN(promotionPrice)
        || promotionPrice <= 0
      ) {
        setError('A promoção precisa de quantidade inteira a partir de 2 e preço maior que zero.')
        return
      }
      promotion = { qtd: promotionQuantity, preco: Math.round(promotionPrice * 100) / 100 }
    }

    setSaving(true)
    setError('')
    setNotice('')
    const productData = {
      category_id: categoryId,
      code: code || null,
      name,
      cost,
      price: Math.round(price * 100) / 100,
      stock_min: minimum,
      stock_max: maximum,
      observations,
      promotion,
      active,
    }

    try {
      if (productFormId) {
        const { data: updated, error: updateError } = await supabase
          .from('products')
          .update(productData)
          .eq('company_id', companyId)
          .eq('id', productFormId)
          .select('id')
          .maybeSingle()
        if (updateError?.code === '23505') throw new Error('Já existe um produto com esse código nesta empresa.')
        if (updateError) throw updateError
        if (!updated) throw new Error('Produto não encontrado ou sem permissão para alterá-lo.')
      } else {
        const { error: insertError } = await supabase.from('products').insert({
          ...productData,
          company_id: companyId,
          created_by: userId,
        })
        if (insertError?.code === '23505') throw new Error('Já existe um produto com esse código nesta empresa.')
        if (insertError) throw insertError
      }

      setProductFormId(null)
      setNotice(productFormId ? 'Produto atualizado.' : 'Produto cadastrado.')
      await loadData()
    } catch (saveError) {
      setError(`Não foi possível salvar o produto: ${messageFrom(saveError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !movementForm) return

    const quantity = Number(movementForm.quantity)
    const unitCost = movementForm.unitCost.trim() ? Number(movementForm.unitCost.replace(',', '.')) : null
    const occurredAt = new Date(movementForm.occurredAt)
    if (!movementForm.productId) {
      setError('Selecione um produto para a movimentação.')
      return
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError('A quantidade deve ser um número inteiro maior que zero.')
      return
    }
    if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      setError('Informe um custo unitário válido ou deixe o campo vazio.')
      return
    }
    if (Number.isNaN(occurredAt.getTime())) {
      setError('Informe uma data e hora válida.')
      return
    }
    if (!canManage && storeDate(occurredAt) < storeDate(new Date())) {
      setError('Somente proprietário ou gerente pode registrar movimentações em dias anteriores.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    const common = {
      p_company_id: companyId,
      p_product_id: movementForm.productId,
      p_type: movementForm.type,
      p_direction: movementForm.direction,
      p_quantity: quantity,
      p_unit_cost: unitCost,
      p_occurred_at: occurredAt.toISOString(),
      p_observations: movementForm.observations.trim(),
    }

    try {
      if (movementForm.id) {
        const { error: updateError } = await supabase.rpc('update_stock_movement', {
          ...common,
          p_movement_id: movementForm.id,
          p_update_product_cost: movementForm.updateProductCost,
        })
        if (updateError) throw updateError
      } else {
        if (!movementTypes.some((item) => item.type === movementForm.type)) {
          throw new Error('Selecione um tipo de movimentação válido.')
        }

        const { error: insertError } = await supabase.rpc('register_stock_movement', {
          ...common,
          p_origin: movementForm.type === 'Estoque inicial' ? 'initial' : 'manual',
          p_update_product_cost: movementForm.updateProductCost,
        })
        if (insertError) throw insertError
      }

      setMovementForm(null)
      setNotice(movementForm.id ? 'Movimentação atualizada.' : 'Movimentação registrada.')
      await loadData()
    } catch (saveError) {
      const error = messageFrom(saveError)
      setError(error.includes('manager_role_required_for_historical_stock_movement')
        ? 'Somente proprietário ou gerente pode registrar movimentações em dias anteriores.'
        : `Não foi possível salvar a movimentação: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  async function deleteMovement(movement: Movement) {
    if (!supabase || !canManage) return
    if (!window.confirm('Excluir esta movimentação? O saldo será atualizado junto com o histórico.')) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { error: deleteError } = await supabase.rpc('delete_stock_movement', {
        p_company_id: companyId,
        p_movement_id: movement.id,
      })
      if (deleteError) throw deleteError

      setMovementForm(null)
      setNotice('Movimentação excluída e saldo atualizado.')
      await loadData()
    } catch (deleteError) {
      setError(`Não foi possível excluir a movimentação: ${messageFrom(deleteError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function toggleProductActive(product: Product) {
    if (!supabase || !canManage) return

    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { data: updated, error: updateError } = await supabase
        .from('products')
        .update({ active: !product.active })
        .eq('company_id', companyId)
        .eq('id', product.id)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!updated) throw new Error('Produto não encontrado ou sem permissão para alterá-lo.')

      setNotice(product.active ? 'Produto arquivado; o histórico foi preservado.' : 'Produto reativado.')
      await loadData()
    } catch (updateError) {
      setError(`Não foi possível atualizar o produto: ${messageFrom(updateError)}`)
    } finally {
      setSaving(false)
    }
  }

  async function loadInitialCatalog() {
    if (!supabase || !canManage) return

    setCatalogLoading(true)
    setError('')
    setNotice('')
    try {
      const { data: currentCategories, error: categoryError } = await supabase
        .from('product_categories')
        .select('id, name')
        .eq('company_id', companyId)
      if (categoryError) throw categoryError

      const categoryMap = new Map(currentCategories.map((category) => [category.name.toLocaleLowerCase('pt-BR'), category.id]))
      const productsToInsert: Database['public']['Tables']['products']['Insert'][] = []
      for (const [categoryName, catalogProducts] of initialCatalog) {
        const categoryId = categoryMap.get(categoryName.toLocaleLowerCase('pt-BR'))
        if (!categoryId) continue
        for (const catalogItem of catalogProducts) {
          const [name, price, promotionQuantity, promotionPrice] = catalogItem
          if (products.some((product) => (
            product.category_id === categoryId
            && product.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')
          ))) continue

          productsToInsert.push({
            company_id: companyId,
            category_id: categoryId,
            name,
            cost: null,
            price,
            observations: price ? '' : 'Preço pendente',
            promotion: promotionQuantity && promotionPrice
              ? { qtd: promotionQuantity, preco: promotionPrice }
              : null,
            created_by: userId,
          })
        }
      }

      if (!productsToInsert.length) {
        setNotice('O catálogo já foi carregado ou não há classificações compatíveis.')
        return
      }
      const { error: insertError } = await supabase.from('products').insert(productsToInsert)
      if (insertError) throw insertError

      setNotice(`Catálogo inicial adicionado: ${productsToInsert.length} produto(s).`)
      await loadData()
    } catch (catalogError) {
      setError(`Não foi possível carregar o catálogo: ${messageFrom(catalogError)}`)
    } finally {
      setCatalogLoading(false)
    }
  }

  const currentProduct = productFormId ? productsById.get(productFormId) : undefined

  return (
    <section className="inventory">
      <div className="section-heading inventory-heading">
        <div>
          <span className="eyebrow">MÓDULO 1 · ESTOQUE</span>
          <h2>Produtos e movimentações</h2>
        </div>
        <span className="step-count">{products.length} produto(s)</span>
      </div>

      {error && <p className="form-alert error inventory-alert" role="alert">{error}</p>}
      {notice && <p className="form-alert success inventory-alert" role="status">{notice}</p>}

      <div className="inventory-tabs" role="tablist" aria-label="Produtos e movimentações">
        <button aria-selected={tab === 'products'} className={tab === 'products' ? 'selected' : ''} onClick={() => setTab('products')} role="tab" type="button">Produtos</button>
        <button aria-selected={tab === 'movements'} className={tab === 'movements' ? 'selected' : ''} onClick={() => setTab('movements')} role="tab" type="button">
          Movimentações <span>{movements.length >= 500 ? '500+' : movements.length}</span>
        </button>
      </div>

      {tab === 'products' && (
        <>
          <div className="inventory-summary">
            <article><span>Produtos exibidos</span><strong>{visibleProducts.length}</strong></article>
            <article><span>Peças em estoque</span><strong>{stockTotals.stock}</strong></article>
            <article><span>Valor a preço de venda</span><strong>{money(stockTotals.value)}</strong></article>
          </div>

          <div className="inventory-card">
            <div className="inventory-toolbar">
              <input aria-label="Buscar produto ou código" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou código…" type="search" value={search} />
              <select aria-label="Filtrar por classificação" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                <option value="">Todas as classificações</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <select aria-label="Filtrar por situação" onChange={(event) => setProductStatus(event.target.value as ProductStatus)} value={productStatus}>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="all">Todos</option>
              </select>
              {canManage && (
                <>
                  <button className="secondary-button" onClick={() => setCategoryFormOpen((open) => !open)} type="button">+ Classificação</button>
                  <button className="primary-button compact" onClick={() => setProductFormId('new')} type="button">+ Produto</button>
                </>
              )}
              {canManage && products.length === 0 && (
                <button className="secondary-button" disabled={catalogLoading} onClick={() => void loadInitialCatalog()} type="button">
                  {catalogLoading ? 'Carregando…' : 'Carregar catálogo inicial'}
                </button>
              )}
            </div>

            {categoryFormOpen && (
              <form className="inline-form" onSubmit={(event) => void addCategory(event)}>
                <label>Nova classificação<input maxLength={100} name="name" required /></label>
                <button className="primary-button compact" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Adicionar'}</button>
                <button className="text-button" onClick={() => setCategoryFormOpen(false)} type="button">Cancelar</button>
              </form>
            )}

            {productFormId && canManage && (
              <form className="inventory-form" onSubmit={(event) => void saveProduct(event)}>
                <div className="form-title-row">
                  <h3>{productFormId === 'new' ? 'Novo produto' : 'Editar produto'}</h3>
                  <button aria-label="Fechar formulário" className="text-button" onClick={() => setProductFormId(null)} type="button">Fechar</button>
                </div>
                <div className="inventory-form-grid">
                  <label>Nome *<input defaultValue={currentProduct?.name ?? ''} maxLength={180} name="name" required /></label>
                  <label>Código<input defaultValue={currentProduct?.code ?? ''} maxLength={80} name="code" /></label>
                  <label>Classificação *
                    <select defaultValue={currentProduct?.category_id ?? categoryFilter} name="categoryId" required>
                      <option value="">Selecione…</option>
                      {categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <label>Preço de venda (R$) *<input defaultValue={currentProduct?.price ?? ''} min="0" name="price" required step="0.01" type="number" /></label>
                  <label>Custo (R$)<input defaultValue={currentProduct?.cost ?? ''} min="0" name="cost" step="0.01" type="number" /></label>
                  <label>Estoque mínimo<input defaultValue={currentProduct?.stock_min ?? ''} min="0" name="stockMin" step="1" type="number" /></label>
                  <label>Estoque máximo<input defaultValue={currentProduct?.stock_max ?? ''} min="0" name="stockMax" step="1" type="number" /></label>
                  <label>Leve (quantidade)<input defaultValue={currentProduct?.promotion?.qtd ?? ''} min="2" name="promotionQuantity" step="1" type="number" /></label>
                  <label>Por (preço total, R$)<input defaultValue={currentProduct?.promotion?.preco ?? ''} min="0.01" name="promotionPrice" step="0.01" type="number" /></label>
                  <label className="wide-field">Observações<textarea defaultValue={currentProduct?.observations ?? ''} maxLength={4000} name="observations" rows={2} /></label>
                  <label className="checkbox-field"><input defaultChecked={currentProduct?.active ?? true} name="active" type="checkbox" /> Produto ativo</label>
                </div>
                <p className="field-hint">O saldo inicial e os ajustes são registrados em Movimentações para manter o histórico. A exclusão é substituída por arquivamento para preservar os registros.</p>
                <div className="form-actions">
                  <button className="text-button" onClick={() => setProductFormId(null)} type="button">Cancelar</button>
                  <button className="primary-button compact" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar produto'}</button>
                </div>
              </form>
            )}

            {loading ? <p className="empty-state" role="status">Carregando produtos…</p> : (
              visibleProducts.length ? (
                <div className="inventory-table-wrap">
                  <table className="inventory-table">
                    <thead><tr><th>Produto</th><th>Classificação</th><th>Preço</th><th>Custo</th><th>Estoque</th><th>Mín. / Máx.</th><th>Situação</th><th /></tr></thead>
                    <tbody>
                      {visibleProducts.map((product) => {
                        const category = categoriesById.get(product.category_id)
                        const negative = product.current_stock < 0
                        const low = negative || (product.stock_min != null && product.current_stock <= product.stock_min)
                        const excess = product.stock_max != null && product.current_stock > product.stock_max
                        return (
                          <tr className={!product.active ? 'row-inactive' : ''} key={product.id}>
                            <td><strong>{product.name}</strong>{product.code && <small>{product.code}</small>}{product.promotion && <small className="promo-tag">{product.promotion.qtd} por {money(product.promotion.preco)}</small>}</td>
                            <td>{category?.name ?? '—'}</td>
                            <td>{money(product.price)}</td>
                            <td>{money(product.cost)}</td>
                            <td className={low ? 'stock-low' : excess ? 'stock-excess' : ''}>{product.current_stock}</td>
                            <td>{product.stock_min ?? '—'} / {product.stock_max ?? '—'}</td>
                            <td><span className={`stock-status${product.active ? low ? ' low' : excess ? ' excess' : ' okay' : ''}`}>{product.active ? negative ? 'Negativo' : low ? 'Baixo' : excess ? 'Excesso' : 'Ativo' : 'Inativo'}</span></td>
                            <td className="inventory-actions">
                              <button className="secondary-button small" onClick={() => { setTab('movements'); setMovementForm(movementDraftFor(product.id)) }} type="button">⇅ Estoque</button>
                              {canManage && <button className="secondary-button small" onClick={() => setProductFormId(product.id)} type="button">Editar</button>}
                              {canManage && <button className="text-button small" onClick={() => void toggleProductActive(product)} type="button">{product.active ? 'Arquivar' : 'Reativar'}</button>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <strong>{products.length ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'}</strong>
                  <p>{products.length ? 'Ajuste os filtros ou a busca.' : 'Cadastre produtos ou carregue o catálogo inicial da loja.'}</p>
                </div>
              )
            )}
          </div>
          <p className="inventory-footnote">O valor do estoque é estimado pelo preço de venda × saldo disponível; não representa o custo contábil.</p>
        </>
      )}

      {tab === 'movements' && (
        <div className="inventory-card">
          <div className="inventory-toolbar">
            <input aria-label="Buscar movimentação por produto" onChange={(event) => setMovementSearch(event.target.value)} placeholder="Buscar produto…" type="search" value={movementSearch} />
            <select aria-label="Filtrar movimentações por tipo" onChange={(event) => setMovementTypeFilter(event.target.value)} value={movementTypeFilter}>
              <option value="">Todos os tipos</option>
              {[...new Set(movements.map((movement) => movement.type))].map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <button className="primary-button compact" onClick={() => setMovementForm(movementDraftFor(products[0]?.id ?? ''))} type="button" disabled={!products.length}>+ Movimentação</button>
          </div>

          {movementForm && (
            <form className="inventory-form" onSubmit={(event) => void saveMovement(event)}>
              <div className="form-title-row">
                <h3>{movementForm.id ? 'Editar movimentação' : 'Nova movimentação'}</h3>
                <button aria-label="Fechar formulário" className="text-button" onClick={() => setMovementForm(null)} type="button">Fechar</button>
              </div>
              <div className="inventory-form-grid">
                <label className="wide-field">Produto *
                  <select onChange={(event) => setMovementForm({ ...movementForm, productId: event.target.value })} required value={movementForm.productId}>
                    <option value="">Selecione…</option>
                    {products.filter((product) => product.active || product.id === movementForm.productId).map((product) => (
                      <option key={product.id} value={product.id}>{product.name} (estoque: {product.current_stock})</option>
                    ))}
                  </select>
                </label>
                <label>Tipo *
                  <select
                    onChange={(event) => {
                                    const selected = movementTypes.find((item) => item.type === event.target.value)
                                    if (selected) {
                                      setMovementForm({
                                        ...movementForm,
                                        type: selected.type,
                                        direction: selected.direction || 1,
                                      })
                                    }
                    }}
                    value={
                      movementTypes.some((item) => item.type === movementForm.type) || movementForm.id
                        ? movementForm.type
                        : ''
                    }
                  >
                    <option value="">Selecione…</option>
                    {movementTypes.map((item) => <option key={item.type} value={item.type}>{item.type} ({item.direction === 0 ? '±' : item.direction > 0 ? '+' : '−'})</option>)}
                    {!movementTypes.some((item) => item.type === movementForm.type) && <option value={movementForm.type}>{movementForm.type} ({movementForm.direction > 0 ? '+' : '−'})</option>}
                  </select>
                </label>
                {movementTypes.find((item) => item.type === movementForm.type)?.direction === 0 && (
                  <label>Direção do ajuste
                    <select onChange={(event) => setMovementForm({ ...movementForm, direction: Number(event.target.value) })} value={movementForm.direction}>
                      <option value={1}>Entrada (+)</option>
                      <option value={-1}>Saída (−)</option>
                    </select>
                  </label>
                )}
                <label>Quantidade *<input min="1" onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} required step="1" type="number" value={movementForm.quantity} /></label>
                <label>Custo unitário (R$)<input min="0" onChange={(event) => setMovementForm({ ...movementForm, unitCost: event.target.value })} step="0.01" type="number" value={movementForm.unitCost} /></label>
                <label>Data e hora<input onChange={(event) => setMovementForm({ ...movementForm, occurredAt: event.target.value })} required type="datetime-local" value={movementForm.occurredAt} /></label>
                <label className="wide-field">Observações<input maxLength={2000} onChange={(event) => setMovementForm({ ...movementForm, observations: event.target.value })} value={movementForm.observations} /></label>
                {canManage && (
                  <label className="checkbox-field">
                    <input checked={movementForm.updateProductCost} onChange={(event) => setMovementForm({ ...movementForm, updateProductCost: event.target.checked })} type="checkbox" />
                    Atualizar custo atual do produto com o custo informado
                  </label>
                )}
              </div>
              {!canManage && <p className="field-hint">Movimentações podem ser registradas pelo operador. Edição de movimentação e alteração de custo exigem gerente ou proprietário.</p>}
              <div className="form-actions">
                {movementForm.id && canManage && <button className="danger-button" onClick={() => {
                  const movement = movements.find((item) => item.id === movementForm.id)
                  if (movement) void deleteMovement(movement)
                }} type="button">Excluir movimentação</button>}
                <button className="text-button" onClick={() => setMovementForm(null)} type="button">Cancelar</button>
                <button className="primary-button compact" disabled={saving} type="submit">{saving ? 'Salvando…' : 'Salvar movimentação'}</button>
              </div>
            </form>
          )}

          {loading ? <p className="empty-state" role="status">Carregando movimentações…</p> : visibleMovements.length ? (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Custo un.</th><th>Observações</th><th /></tr></thead>
                <tbody>
                  {visibleMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{new Date(movement.occurred_at).toLocaleString('pt-BR')}</td>
                      <td>{productsById.get(movement.product_id)?.name ?? '(produto indisponível)'}</td>
                      <td>{movement.type}</td>
                      <td className={movement.direction > 0 ? 'stock-positive' : 'stock-low'}>{movement.direction > 0 ? '+' : '−'}{movement.quantity}</td>
                      <td>{money(movement.unit_cost)}</td>
                      <td>{movement.observations || '—'}</td>
                      <td className="inventory-actions">
                        {canManage && movement.origin !== 'sale' && (
                          <button className="secondary-button small" onClick={() => setMovementForm(movementDraftFor(movement.product_id, movement))} type="button">Editar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {movements.length >= 500 && <p className="inventory-footnote">Exibindo os 500 registros mais recentes. Refine os filtros para localizar uma movimentação.</p>}
            </div>
          ) : <p className="empty-state">Nenhuma movimentação encontrada.</p>}
        </div>
      )}
    </section>
  )
}

export default Inventory
