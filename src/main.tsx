import { BarChart3, Database, GanttChart, MoveUpRight, Network, TrendingUp } from 'lucide-react'
import { StrictMode, useEffect, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/geist-mono'
import { DashboardFrame } from './DashboardFrame'
import { FinancialAnalysisView } from './FinancialAnalysisView'
import './demo.css'

const views = {
  relationships: {
    label: 'Relationships',
    title: 'Company relationships',
    description: 'Trace investment, compute, and supply-chain ties across the AI industry.',
    Icon: Network,
    src: './relationships/index.html?embedded=1',
  },
  financials: {
    label: 'Financials',
    title: 'Financial analysis',
    description: 'Compare AI company finances and track quarterly capital spending.',
    Icon: BarChart3,
  },
  deals: {
    label: 'Deals',
    title: 'Compute deals',
    description: 'Explore deal announcements by date and type, then inspect their terms and sources.',
    Icon: GanttChart,
    src: './deals/?embedded=1',
  },
}
type View = keyof typeof views
const viewIds: readonly View[] = ['relationships', 'financials', 'deals']

function currentView(): View {
  const value = new URLSearchParams(window.location.search).get('view')
  return viewIds.find((id) => id === value) ??
    (['#comparison', '#capex', '#methodology'].includes(window.location.hash) ? 'financials' : 'relationships')
}

function App() {
  const [navigation, setNavigation] = useState(() => {
    const active = currentView()
    return { active, visited: new Set([active]) }
  })
  const { active, visited } = navigation
  const view = views[active]

  useEffect(() => {
    function restoreView() {
      const next = currentView()
      setNavigation(({ visited }) => ({ active: next, visited: new Set([...visited, next]) }))
    }
    window.addEventListener('popstate', restoreView)
    return () => window.removeEventListener('popstate', restoreView)
  }, [])

  useEffect(() => {
    document.title = `${view.title} | AI Money Machine`
  }, [view.title])

  function navigate(event: MouseEvent<HTMLAnchorElement>, next: View) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (next !== active) {
      window.history.pushState(null, '', event.currentTarget.href)
      setNavigation(({ visited }) => ({ active: next, visited: new Set([...visited, next]) }))
    }
    window.scrollTo(0, 0)
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to analysis</a>
      <header className="dashboard-header">
        <div className="page-width dashboard-header-inner">
          <a className="dashboard-brand" href="?view=relationships" onClick={(event) => navigate(event, 'relationships')}>
            <span className="dashboard-brand-mark"><TrendingUp size={18} aria-hidden="true" /></span>
            <span>AI Money Machine</span>
          </a>
          <nav className="dashboard-navigation" aria-label="Dashboard views">
            {viewIds.map((id) => {
              const { label, Icon } = views[id]
              return (
                <a
                  key={id}
                  href={`?view=${id}`}
                  aria-current={active === id ? 'page' : undefined}
                  onClick={(event) => navigate(event, id)}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </a>
              )
            })}
          </nav>
          <a className="header-sources" href="#sources"><Database size={15} aria-hidden="true" /> Data sources</a>
        </div>
      </header>
      <main id="main" className="page-width page-content" tabIndex={-1}>
        <div className="page-intro">
          <h1>{view.title}</h1>
          <p>{view.description}</p>
        </div>
        {viewIds.map((id) => visited.has(id) && (
          <div key={id} className="dashboard-view" hidden={active !== id}>
            {id === 'financials' ? <FinancialAnalysisView /> :
              <DashboardFrame view={id} title={views[id].title} src={views[id].src} active={active === id} />}
          </div>
        ))}
      </main>
      <footer id="sources" className="page-width source-footer">
        <span>Data sources</span>
        <a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces">SEC EDGAR <MoveUpRight size={12} /></a>
        <a href="https://datacentercensus.com/ai-capex">Data Center Census <MoveUpRight size={12} /></a>
        <a href="https://epoch.ai/data/ai-companies">Epoch AI <MoveUpRight size={12} /></a>
        <a href="https://www.regardsofwallstreet.com/data/capex">Hyperscaler Capex Tracker <MoveUpRight size={12} /></a>
        <a href="https://www.regardsofwallstreet.com/data/ai-deals">AI Compute Deal Ledger <MoveUpRight size={12} /></a>
        <a href="https://www.regardsofwallstreet.com/data/rpo">RPO and Backlog Tracker <MoveUpRight size={12} /></a>
        <a href="https://stateofai.world/open-data">State of AI World <MoveUpRight size={12} /></a>
      </footer>
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(<StrictMode><App /></StrictMode>)
