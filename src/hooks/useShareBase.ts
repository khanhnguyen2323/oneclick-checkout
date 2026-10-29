import { useEffect, useState } from 'react'
import { getShareBase } from '@/lib/share'

/** Resolves the share base once on mount; null until the handshake settles. */
export function useShareBase(): string | null {
  const [base, setBase] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getShareBase().then((b) => {
      if (live) setBase(b)
    })
    return () => {
      live = false
    }
  }, [])
  return base
}

/** Shareable payment link. Only the invoice id goes in the path. */
export function payLink(base: string, id: bigint | number | string): string {
  return `${base}/pay/${String(id)}`
}
