import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'merchant' }
  | { name: 'pay'; id: bigint | null }
  | { name: 'receipt'; id: bigint | null }
  | { name: 'notfound' }

function parseId(raw: string | undefined): bigint | null {
  if (!raw || !/^\d{1,18}$/.test(raw)) return null
  const id = BigInt(raw)
  return id > 0n ? id : null
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  const [first, second] = parts
  if (!first) return { name: 'home' }
  if (first === 'merchant' && parts.length === 1) return { name: 'merchant' }
  if (first === 'pay' && parts.length <= 2) return { name: 'pay', id: parseId(second) }
  if (first === 'receipt' && parts.length <= 2) return { name: 'receipt', id: parseId(second) }
  return { name: 'notfound' }
}

export function navigate(path: string) {
  if (window.location.pathname + window.location.search === path) return
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0 })
}

/** Path-based routing: /, /merchant, /pay/:id, /receipt/:id. */
export function useRoute(): Route {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return parseRoute(pathname)
}
