import { lazy, Suspense, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { formatCnpj, isValidCnpj, normalizeCnpj } from './lib/cnpj'
import type { CompanyRole } from './lib/database.types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

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
  cnpj: string
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
      setAuthError('')
      setAuthMessage('')
      setAuthLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || receivedAuthEvent) return
      if (error) setAuthError(error.message)
      setSession(data.session)
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
        if (fullName.trim().length < 2) {
          setAuthError('Informe seu nome completo.')
          return
        }
        if (password.length < 8) {
          setAuthError('A senha deve ter pelo menos 8 caracteres.')
          return
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        })

        if (error) throw error
        if (data.session) {
          setSession(data.session)
          setAuthMessage('Conta criada. Agora cadastre sua empresa para começar.')
        } else {
          setAuthMessage('Conta criada. Confirme seu e-mail e entre para continuar.')
          setAuthMode('login')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (error) throw error
        setSession(data.session)
      }
    } catch (error) {
      setAuthError(errorMessage(error))
    } finally {
      setAuthBusy(false)
    }
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
    if (!isValidCnpj(cnpj)) {
      setCompanyError('O CNPJ informado é inválido. Confira os 14 dígitos.')
      return
    }

    setCompanyBusy(true)
    try {
      const { data, error } = await supabase.rpc('create_company', {
        p_legal_name: legalName,
        p_trade_name: tradeName || null,
        p_cnpj: cnpj,
      })

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe uma empresa cadastrada com este CNPJ.')
        }
        if (error.message.includes('invalid_cnpj')) {
          throw new Error('O CNPJ informado é inválido.')
        }
        if (error.message.includes('invalid_legal_name')) {
          throw new Error('A razão social precisa ter entre 2 e 180 caracteres.')
        }
        throw error
      }
      if (!data) throw new Error('O banco não retornou o identificador da empresa criada.')

      setSelectedCompanyId(data)
      setCompanyMessage('Empresa cadastrada. Seu usuário recebeu o papel de proprietário.')
      setMembershipReload((value) => value + 1)
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

  if (!isSupabaseConfigured) {
    return (
      <div className="setup-page">
        <section className="setup-card">
          <span className="brand-mark">MS</span>
          <p className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</p>
          <h1>Conecte um projeto Supabase</h1>
          <p>
            Crie um arquivo <code>.env</code> baseado em <code>.env.example</code>
            {' '}e preencha a URL e a chave pública do seu projeto. Nunca coloque
            a chave <code>service_role</code> no front-end.
          </p>
        </section>
      </div>
    )
  }

  if (authLoading) {
    return <div className="setup-page"><p role="status">Verificando sessão…</p></div>
  }

  if (!session) {
    return (
      <div className="setup-page">
        <section className="auth-card">
          <a className="brand auth-brand" href="/">
            <span className="brand-mark">NX</span>
            <span><strong>NEXORA CRM</strong><small>Gestão</small></span>
          </a>
          <span className="eyebrow">ACESSO SEGURO</span>
          <h1>{authMode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h1>
          <p className="form-intro">Acesse suas empresas e dados com segurança.</p>

          <div className="auth-tabs" role="tablist" aria-label="Tipo de acesso">
            <button
              aria-selected={authMode === 'login'}
              className={authMode === 'login' ? 'selected' : ''}
              onClick={() => { setAuthMode('login'); setAuthError(''); setAuthMessage('') }}
              role="tab"
              type="button"
            >
              Entrar
            </button>
            <button
              aria-selected={authMode === 'signup'}
              className={authMode === 'signup' ? 'selected' : ''}
              onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthMessage('') }}
              role="tab"
              type="button"
            >
              Criar conta
            </button>
          </div>

          <form className="form-stack" onSubmit={submitAuth}>
            {authMode === 'signup' && (
              <label>
                Nome completo
                <input autoComplete="name" maxLength={120} minLength={2} onChange={(event) => setFullName(event.target.value)} required value={fullName} />
              </label>
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
            <button className="primary-button" disabled={authBusy} type="submit">
              {authBusy ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>
          <p className="privacy-note">A autenticação é gerenciada pelo Supabase Auth.</p>
        </section>
      </div>
    )
  }

  const selectedMembership = memberships.find((item) => item.company_id === selectedCompanyId)

  if (membershipsLoading) {
    return <div className="setup-page"><p role="status">Carregando empresas…</p></div>
  }

  if (membershipLoadError) {
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

  if (!memberships.length) {
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

  return (
    <div className="app-shell">
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
          Sessão autenticada
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
              <select aria-label="Empresa ativa" onChange={(event) => setSelectedCompanyId(event.target.value)} value={selectedCompanyId}>
                {memberships.map((membership) => (
                  <option key={membership.company_id} value={membership.company_id}>
                    {membership.company.trade_name || membership.company.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <button className="text-button" onClick={() => void signOut()} type="button">Sair</button>
          </div>
        </header>

        {companyError && <p className="form-alert error page-alert" role="alert">{companyError}</p>}
        {(activeModule === 'vendas' || activeModule === 'caixa') && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando Vendas/PDV…</p>}>
            <Sales
              companyId={selectedMembership.company_id}
              initialTab={activeModule === 'caixa' ? 'cash' : 'pos'}
              key={`sales-${activeModule}-${selectedMembership.company_id}`}
              role={selectedMembership.role}
              userId={session.user.id}
              userName={String(session.user.user_metadata.full_name ?? '')}
            />
          </Suspense>
        ) : activeModule === 'estoque' && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando estoque…</p>}>
            <Inventory companyId={selectedMembership.company_id} role={selectedMembership.role} userId={session.user.id} />
          </Suspense>
        ) : activeModule === 'clientes' && selectedMembership ? (
          <Suspense fallback={<p role="status">Carregando CRM…</p>}>
            <Customers
              companyId={selectedMembership.company_id}
              companyName={selectedMembership.company.trade_name || selectedMembership.company.legal_name}
              key={`customers-${selectedMembership.company_id}`}
              role={selectedMembership.role}
              userId={session.user.id}
            />
          </Suspense>
        ) : (
          <>
            <section className="welcome-card">
              <div className="welcome-copy">
                <span className="welcome-kicker">{selectedMembership ? roleLabels[selectedMembership.role] : 'EMPRESA'}</span>
                <h2>{selectedMembership?.company.trade_name || selectedMembership?.company.legal_name}</h2>
                <p>
                  CNPJ {selectedMembership ? formatCnpj(selectedMembership.company.cnpj) : ''}
                  {' · '}Os dados dos módulos ainda não foram conectados. Cada registro futuro será
                  associado à empresa ativa e protegido por políticas RLS.
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
              Login e associação à empresa usam Supabase Auth. A autorização de acesso
              aos dados é aplicada no banco; esta tela não substitui as políticas RLS.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

function CnpjField() {
  const [cnpj, setCnpj] = useState('')

  return (
    <label>
      CNPJ
      <input
        autoComplete="off"
        inputMode="numeric"
        maxLength={18}
        name="cnpj"
        onChange={(event) => setCnpj(formatCnpj(event.target.value))}
        placeholder="00.000.000/0000-00"
        required
        value={cnpj}
      />
      <span className="field-hint">Validado pelos dígitos verificadores; sem consulta externa.</span>
    </label>
  )
}

export default App
