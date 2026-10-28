import { lazy, Suspense, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { formatCnpj, isValidCnpj, normalizeCnpj } from './lib/cnpj'
import type { CompanyRole } from './lib/database.types'
import { DEMO_COMPANY, DEMO_COMPANY_ID, DEMO_USER_ID, resetDemoData } from './lib/demo'
import { isSupabaseConfigured, setDemoSupabaseMode, supabase } from './lib/supabase'

const Customers = lazy(() => import('./Customers'))
const Sales = lazy(() => import('./Sales'))
const Inventory = lazy(() => import('./Inventory'))

const modules = [
  { id: 'inicio', label: 'Início', icon: '⌂' },
  { id: 'vendas', label: 'Vendas', icon: '▣' },
  { id: 'caixa', label: 'Caixa', icon: '$' },
  { id: 'estoque', label: 'Estoque', icon: '▦' },
  { id: 'clientes', label: 'Clientes', icon: '♧' },
  { id: 'resultado', label: 'Resultado', icon: '▥' },
  { id: 'config', label: 'Configurações', icon: '⚙' },
] as const

type ModuleId = (typeof modules)[number]['id']
type Company = {
  id: string
  legal_name: string
  trade_name: string | null
  cnpj: string | null
}
type CompanyMembership = {
  company_id: string
  role: CompanyRole
  company: Company
}

const roleLabels: Record<CompanyRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  operator: 'Operador',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [entryScreen, setEntryScreen] = useState<'welcome' | 'auth'>('welcome')
  const [demoMode, setDemoMode] = useState(false)
  const [demoVersion, setDemoVersion] = useState(0)
  const [demoError, setDemoError] = useState('')
  const [pendingCompany, setPendingCompany] = useState<{ legalName: string; tradeName: string; cnpj: string } | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [memberships, setMemberships] = useState<CompanyMembership[]>([])
  const [membershipsLoading, setMembershipsLoading] = useState(false)
  const [membershipLoadError, setMembershipLoadError] = useState('')
  const [membershipReload, setMembershipReload] = useState(0)
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [companyError, setCompanyError] = useState('')
  const [companyMessage, setCompanyMessage] = useState('')
  const [companyBusy, setCompanyBusy] = useState(false)
  const [activeModule, setActiveModule] = useState<ModuleId>('inicio')

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }

    let active = true
    let receivedAuthEvent = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      receivedAuthEvent = true
      setSession(nextSession)
      setMembershipsLoading(Boolean(nextSession))
      setAuthError('')
      setAuthMessage('')
      setAuthLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || receivedAuthEvent) return
      if (error) setAuthError(error.message)
      setSession(data.session)
      setMembershipsLoading(Boolean(data.session))
      setAuthLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user.id) {
      setMemberships([])
      setSelectedCompanyId('')
      setMembershipLoadError('')
      setMembershipsLoading(false)
      return
    }

    let active = true
    const userId = session.user.id
    setMembershipsLoading(true)
    setMembershipLoadError('')

    void (async () => {
      try {
        const { data: memberRows, error: memberError } = await supabase
          .from('company_members')
          .select('company_id, role')
          .eq('user_id', userId)
          .eq('status', 'active')

        if (memberError) throw memberError

        const companyIds = memberRows.map((member) => member.company_id)
        if (!companyIds.length) {
          if (active) {
            setMemberships([])
            setSelectedCompanyId('')
          }
          return
        }

        const { data: companyRows, error: companyErrorResult } = await supabase
          .from('companies')
          .select('id, legal_name, trade_name, cnpj')
          .in('id', companyIds)

        if (companyErrorResult) throw companyErrorResult

        const nextMemberships = memberRows.flatMap((member) => {
          const company = companyRows.find((row) => row.id === member.company_id)
          return company ? [{ company_id: member.company_id, role: member.role, company }] : []
        })

        if (nextMemberships.length !== memberRows.length) {
          throw new Error('Uma ou mais empresas vinculadas não puderam ser carregadas. Confira as políticas de acesso.')
        }

        if (active) {
          setMemberships(nextMemberships)
          setSelectedCompanyId((current) =>
            nextMemberships.some((membership) => membership.company_id === current)
              ? current
              : nextMemberships[0]?.company_id ?? '',
          )
        }
      } catch (error) {
        if (active) {
          setMemberships([])
          setSelectedCompanyId('')
          setMembershipLoadError(`Não foi possível carregar suas empresas: ${errorMessage(error)}`)
        }
      } finally {
        if (active) setMembershipsLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [session?.user.id, membershipReload])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setAuthError('')
    setAuthMessage('')
    setAuthBusy(true)

    try {
      if (authMode === 'signup') {
        const formData = new FormData(event.currentTarget)
        const legalName = String(formData.get('legalName') ?? '').trim()
        const tradeName = String(formData.get('tradeName') ?? '').trim()
        const cnpj = normalizeCnpj(String(formData.get('cnpj') ?? ''))

        if (fullName.trim().length < 2) {
          setAuthError('Informe seu nome completo.')
          return
        }
        if (password.length < 8) {
          setAuthError('A senha deve ter pelo menos 8 caracteres.')
          return
        }
        if (legalName.length < 2) {
          setAuthError('Informe a razão social da empresa.')
          return
        }
        if (cnpj && !isValidCnpj(cnpj)) {
          setAuthError('O CNPJ informado é inválido. Confira os 14 dígitos.')
          return
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        })

        if (error) throw error
        const companyDraft = { legalName, tradeName, cnpj }
        if (data.session) {
          setSession(data.session)
          setMembershipsLoading(true)
          await createCompany(companyDraft)
        } else {
          setPendingCompany(companyDraft)
          setAuthMessage('Conta criada. Confirme seu e-mail e entre; sua empresa será cadastrada automaticamente em seguida.')
          setAuthMode('login')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (error) throw error
        setSession(data.session)
        setMembershipsLoading(Boolean(data.session))
        if (pendingCompany) {
          await createCompany(pendingCompany)
          setPendingCompany(null)
        }
      }
    } catch (error) {
      setAuthError(errorMessage(error))
    } finally {
      setAuthBusy(false)
    }
  }

  async function createCompany(company: { legalName: string; tradeName: string; cnpj: string }): Promise<void> {
    if (!supabase) return

    setCompanyError('')
    setCompanyMessage('')
    const { data, error } = await supabase.rpc('create_company', {
      p_legal_name: company.legalName,
      p_trade_name: company.tradeName || null,
      p_cnpj: company.cnpj || null,
    })

    if (error) {
      if (error.code === '23505') throw new Error('Já existe uma empresa cadastrada com este CNPJ.')
      if (error.message.includes('invalid_cnpj')) throw new Error('O CNPJ informado é inválido.')
      if (error.message.includes('invalid_legal_name')) throw new Error('A razão social precisa ter entre 2 e 180 caracteres.')
      throw error
    }
    if (!data) throw new Error('O banco não retornou o identificador da empresa criada.')

    setSelectedCompanyId(data)
    setCompanyMessage('Empresa cadastrada. Seu usuário recebeu o papel de proprietário.')
    setMembershipReload((value) => value + 1)
  }

  async function submitCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    const formData = new FormData(event.currentTarget)
    const legalName = String(formData.get('legalName') ?? '').trim()
    const tradeName = String(formData.get('tradeName') ?? '').trim()
    const cnpj = normalizeCnpj(String(formData.get('cnpj') ?? ''))

    setCompanyError('')
    setCompanyMessage('')

    if (legalName.length < 2) {
      setCompanyError('Informe a razão social da empresa.')
      return
    }
    if (cnpj && !isValidCnpj(cnpj)) {
      setCompanyError('O CNPJ informado é inválido. Confira os 14 dígitos.')
      return
    }

    setCompanyBusy(true)
    try {
      await createCompany({ legalName, tradeName, cnpj })
    } catch (error) {
      setCompanyError(`Não foi possível cadastrar a empresa: ${errorMessage(error)}`)
    } finally {
      setCompanyBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setAuthError('')
    const { error } = await supabase.auth.signOut()
    if (error) setAuthError(`Não foi possível encerrar a sessão: ${error.message}`)
  }

  function enterDemo() {
    setDemoSupabaseMode(true)
    setDemoMode(true)
    setActiveModule('inicio')
    setDemoError('')
  }

  function leaveDemo() {
    setDemoSupabaseMode(false)
    setDemoMode(false)
    setDemoError('')
    setEntryScreen('welcome')
    setActiveModule('inicio')
  }

  function restartDemo() {
    try {
      resetDemoData()
      setDemoVersion((version) => version + 1)
      setDemoError('')
    } catch (error) {
      setDemoError(`Não foi possível reiniciar a demo: ${errorMessage(error)}`)
    }
  }

  if (!demoMode && authLoading) {
    return <div className="setup-page"><p role="status">Verificando sessão…</p></div>
  }

  // An existing Supabase session skips onboarding; unauthenticated visitors start at the welcome screen.
  if (!demoMode && !session && entryScreen === 'welcome') {
    return (
      <div className="setup-page welcome-page">
        <section className="welcome-entry-card">
          <a className="brand entry-brand" href="/" aria-label="Nexora CRM">
            <span className="brand-mark">NX</span>
            <span><strong>NEXORA CRM</strong><small>Gestão inteligente para sua loja</small></span>
          </a>
          <span className="eyebrow">GESTÃO SIMPLES, LOJA EM MOVIMENTO</span>
          <h1>Bem-vindo ao Nexora</h1>
          <p>Organize vendas, estoque e relacionamento com clientes em um só lugar.</p>
          <div className="entry-actions">
            <button
              className="primary-button"
              onClick={() => { setAuthMode('signup'); setEntryScreen('auth'); setAuthError(''); setAuthMessage('') }}
              type="button"
            >
              Cadastrar a empresa
            </button>
            <button className="secondary-button" onClick={enterDemo} type="button">Ver demo</button>
          </div>
          {!isSupabaseConfigured && (
            <p className="form-alert error" role="status">
              O cadastro real ficará disponível depois de configurar o Supabase. A demonstração já pode ser explorada.
            </p>
          )}
          <button
            className="text-button entry-login"
            onClick={() => { setAuthMode('login'); setEntryScreen('auth'); setAuthError(''); setAuthMessage('') }}
            type="button"
          >
            Já tem conta? Entrar
          </button>
        </section>
      </div>
    )
  }

  if (!demoMode && !session) {
    return (
      <div className="setup-page">
        <section className="auth-card">
          <button className="back-link" onClick={() => { setEntryScreen('welcome'); setAuthError(''); setAuthMessage('') }} type="button">
            ← Voltar ao início
          </button>
          <a className="brand auth-brand" href="/">
            <span className="brand-mark">NX</span>
            <span><strong>NEXORA CRM</strong><small>Gestão</small></span>
          </a>
          <span className="eyebrow">{authMode === 'login' ? 'ACESSO SEGURO' : 'PRIMEIRO ACESSO'}</span>
          <h1>{authMode === 'login' ? 'Entre na sua conta' : 'Cadastre sua empresa'}</h1>
          <p className="form-intro">
            {authMode === 'login' ? 'Acesse suas empresas e dados com segurança.' : 'Crie seu acesso e informe os dados básicos da empresa.'}
          </p>

          <form className="form-stack" onSubmit={submitAuth}>
            {authMode === 'signup' && (
              <label>
                Nome completo
                <input autoComplete="name" maxLength={120} minLength={2} onChange={(event) => setFullName(event.target.value)} required value={fullName} />
              </label>
            )}
            {authMode === 'signup' && (
              <>
                <label>
                  Razão social da empresa
                  <input autoComplete="organization" maxLength={180} minLength={2} name="legalName" required />
                </label>
                <label>
                  Nome fantasia <span className="optional">(opcional)</span>
                  <input maxLength={180} name="tradeName" />
                </label>
                <CnpjField />
              </>
            )}
            <label>
              E-mail
              <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            </label>
            <label>
              Senha
              <input autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
            </label>
            {authError && <p className="form-alert error" role="alert">{authError}</p>}
            {authMessage && <p className="form-alert success" role="status">{authMessage}</p>}
            {!isSupabaseConfigured && <p className="form-alert error" role="alert">Configure o Supabase para cadastrar ou acessar uma empresa real.</p>}
            <button className="primary-button" disabled={authBusy || !isSupabaseConfigured} type="submit">
              {authBusy ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar conta e acessar'}
            </button>
          </form>
          <p className="privacy-note">
            {authMode === 'login' ? (
              <>Ainda não tem conta? <button className="inline-link" onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthMessage('') }} type="button">Cadastrar a empresa</button></>
            ) : 'A autenticação é gerenciada pelo Supabase Auth.'}
          </p>
        </section>
      </div>
    )
  }

  const demoMembership: CompanyMembership = { company_id: DEMO_COMPANY_ID, role: 'owner', company: DEMO_COMPANY }
  const selectedMembership = demoMode
    ? demoMembership
    : memberships.find((item) => item.company_id === selectedCompanyId)

  if (!demoMode && membershipsLoading) {
    return <div className="setup-page"><p role="status">Carregando empresas…</p></div>
  }

  if (!demoMode && membershipLoadError) {
    return (
      <div className="setup-page">
        <section className="auth-card">
          <span className="eyebrow">EMPRESAS</span>
          <h1>Não foi possível carregar o acesso</h1>
          <p className="form-alert error" role="alert">{membershipLoadError}</p>
          <button className="primary-button" onClick={() => setMembershipReload((value) => value + 1)} type="button">
            Tentar novamente
          </button>
          <button className="text-button" onClick={() => void signOut()} type="button">Sair da conta</button>
        </section>
      </div>
    )
  }

  if (!demoMode && !memberships.length) {
    return (
      <div className="setup-page">
        <section className="auth-card company-card">
          <span className="eyebrow">PRIMEIRO ACESSO</span>
          <h1>Cadastre sua empresa</h1>
          <p className="form-intro">Sua conta será vinculada como proprietária desta empresa.</p>
          <form className="form-stack" onSubmit={submitCompany}>
            <label>
              Razão social
              <input autoComplete="organization" maxLength={180} name="legalName" required />
            </label>
            <label>
              Nome fantasia <span className="optional">(opcional)</span>
              <input maxLength={180} name="tradeName" />
            </label>
            <CnpjField />
            {companyError && <p className="form-alert error" role="alert">{companyError}</p>}
            {companyMessage && <p className="form-alert success" role="status">{companyMessage}</p>}
            <button className="primary-button" disabled={companyBusy} type="submit">
              {companyBusy ? 'Cadastrando…' : 'Cadastrar empresa'}
            </button>
          </form>
          <button className="text-button" onClick={() => void signOut()} type="button">Sair da conta</button>
        </section>
      </div>
    )
  }

  const activeModuleInfo = modules.find((item) => item.id === activeModule)
  const currentUserId = demoMode ? DEMO_USER_ID : session?.user.id ?? ''
  const currentUserName = demoMode ? 'Operador da Demo' : String(session?.user.user_metadata.full_name ?? '')
  const visibleMemberships = demoMode ? [demoMembership] : memberships

  return (
    <>
    {demoMode && (
      <div className="demo-banner" role="region" aria-label="Modo demonstração">
        <p><strong>Modo demonstração</strong> — os dados são fictícios e ficam isolados neste navegador.</p>
        <div>
          <button className="demo-banner-button" onClick={restartDemo} type="button">Reiniciar demo</button>
          <button className="demo-banner-button" onClick={leaveDemo} type="button">Sair da demo / Cadastrar minha empresa</button>
        </div>
      </div>
    )}
    <div className={`app-shell${demoMode ? ' demo-mode' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setActiveModule('inicio')}>
          <span className="brand-mark">NX</span>
          <span><strong>NEXORA CRM</strong><small>Gestão</small></span>
        </a>

        <p className="nav-label">SISTEMA</p>
        <nav aria-label="Módulos do sistema">
          {modules.map((item) => (
            <button
              aria-current={activeModule === item.id ? 'page' : undefined}
              className={`nav-item${activeModule === item.id ? ' active' : ''}`}
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id !== 'inicio' && item.id !== 'estoque' && item.id !== 'clientes' && item.id !== 'vendas' && item.id !== 'caixa' && <span className="coming-soon">em migração</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          {demoMode ? 'Dados locais da demo' : 'Sessão autenticada'}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">NEXORA CRM</span>
            <h1>{activeModuleInfo?.label}</h1>
          </div>
          <div className="account-controls">
            <label className="company-switcher">
              <span>Empresa</span>
              <select aria-label="Empresa ativa" onChange={(event) => setSelectedCompanyId(event.target.value)} value={demoMode ? DEMO_COMPANY_ID : selectedCompanyId}>
                {visibleMemberships.map((membership) => (
                  <option key={membership.company_id} value={membership.company_id}>
                    {membership.company.trade_name || membership.company.legal_name}
                  </option>
                ))}
              </select>
            </label>
            {demoMode
              ? <button className="text-button" onClick={leaveDemo} type="button">Sair da demo</button>
              : <button className="text-button" onClick={() => void signOut()} type="button">Sair</button>}
          </div>
        </header>

        {demoError && <p className="form-alert error page-alert" role="alert">{demoError}</p>}
        {companyError && <p className="form-alert error page-alert" role="alert">{companyError}</p>}
        {(activeModule === 'vendas' || activeModule === 'caixa') && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando Vendas/PDV…</p>}>
            <Sales
              companyId={selectedMembership.company_id}
              initialTab={activeModule === 'caixa' ? 'cash' : 'pos'}
              key={`sales-${activeModule}-${selectedMembership.company_id}-${demoVersion}`}
              role={selectedMembership.role}
              userId={currentUserId}
              userName={currentUserName}
            />
          </Suspense>
        ) : activeModule === 'estoque' && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando estoque…</p>}>
            <Inventory key={`inventory-${selectedMembership.company_id}-${demoVersion}`} companyId={selectedMembership.company_id} role={selectedMembership.role} userId={currentUserId} />
          </Suspense>
        ) : activeModule === 'clientes' && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando CRM…</p>}>
            <Customers
              companyId={selectedMembership.company_id}
              companyName={selectedMembership.company.trade_name || selectedMembership.company.legal_name}
              key={`customers-${selectedMembership.company_id}-${demoVersion}`}
              role={selectedMembership.role}
              userId={currentUserId}
            />
          </Suspense>
        ) : (
          <>
            <section className="welcome-card">
              <div className="welcome-copy">
                <span className="welcome-kicker">{selectedMembership ? roleLabels[selectedMembership.role] : 'EMPRESA'}</span>
                <h2>{selectedMembership?.company.trade_name || selectedMembership?.company.legal_name}</h2>
                <p>
                  {selectedMembership?.company.cnpj
                    ? `CNPJ ${formatCnpj(selectedMembership.company.cnpj)}`
                    : 'CNPJ não informado'}
                  {demoMode
                    ? ' · Explore os módulos operacionais com dados fictícios.'
                    : ' · Seus dados são associados à empresa ativa e protegidos por políticas RLS.'}
                </p>
              </div>
              <div className="welcome-symbol" aria-hidden="true">MS</div>
            </section>
            <section className="section-heading">
              <div>
                <span className="eyebrow">PRÓXIMA FASE</span>
                <h2>{activeModule === 'inicio' ? 'Acesso e empresa configurados' : `${activeModuleInfo?.label} ainda não migrado`}</h2>
              </div>
              <span className="step-count">Fundação multiempresa</span>
            </section>
            <p className="notice">
              {demoMode
                ? 'Vendas/PDV, caixa, estoque e CRM estão preenchidos com dados de demonstração. Resultado e Configurações seguem em migração.'
                : 'Login e associação à empresa usam Supabase Auth. A autorização de acesso aos dados é aplicada no banco; esta tela não substitui as políticas RLS.'}
            </p>
          </>
        )}
      </main>
    </div>
    </>
  )
}

function CnpjField() {
  const [cnpj, setCnpj] = useState('')

  return (
    <label>
      CNPJ <span className="optional">(opcional)</span>
      <input
        autoComplete="off"
        inputMode="numeric"
        maxLength={18}
        name="cnpj"
        onChange={(event) => setCnpj(formatCnpj(event.target.value))}
        placeholder="00.000.000/0000-00"
        value={cnpj}
      />
      <span className="field-hint">Validado pelos dígitos verificadores; sem consulta externa.</span>
    </label>
  )
}

export default App
