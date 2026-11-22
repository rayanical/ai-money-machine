import { useEffect, useState } from 'react'

interface DashboardFrameProps {
  view: 'relationships' | 'deals'
  src: string
  title: string
  active: boolean
}

export function DashboardFrame({ view, src, title, active }: DashboardFrameProps) {
  const [content, setContent] = useState<Document | null>(null)
  const [height, setHeight] = useState<number>()

  useEffect(() => {
    if (!active || !content) return
    const workspace = content.querySelector(view === 'deals' ? 'main' : '.graph-workspace')
    if (!workspace) return

    function fit() {
      if (!workspace) return
      if (view === 'relationships' && content?.defaultView?.getComputedStyle(workspace).position === 'fixed') {
        setHeight(undefined)
        return
      }
      const { width, height } = workspace.getBoundingClientRect()
      if (width && height) setHeight(Math.ceil(height) + (view === 'relationships' ? 2 : 0))
    }

    const observer = new ResizeObserver(fit)
    observer.observe(workspace)
    fit()
    return () => observer.disconnect()
  }, [active, content, view])

  return (
    <iframe
      className={`dashboard-frame dashboard-frame--${view}`}
      data-view={view}
      title={title}
      src={src}
      style={height ? { height } : undefined}
      onLoad={(event) => setContent(event.currentTarget.contentDocument)}
    />
  )
}
