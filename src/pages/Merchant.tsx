import { useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import type { Address } from 'viem'
import { ARC } from '@/config/network'
import { CreateInvoice } from '@/components/CreateInvoice'
import { InvoiceList } from '@/components/InvoiceList'
import { Spinner } from '@/components/ui'
import { useFeeBps } from '@/hooks/useFeeBps'
import { useMerchantInvoices } from '@/hooks/useMerchantInvoices'
import { feeFor, fmtUsdc, statusOf } from '@/lib/vault'

export function Merchant({ vault }: { vault: Address }) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = () => setRefreshKey((k) => k + 1)
  const data = useMerchantInvoices(vault, refreshKey)
  const { data: feeBps } = useFeeBps(vault)

  const paid = data.invoices.filter((i) => statusOf(i) === 'paid')
  const pending = data.invoices.filter((i) => statusOf(i) === 'unpaid')
  const received = paid.reduce((sum, i) => sum + i.amount - feeFor(i.amount, BigInt(feeBps ?? 0)), 0n)
  const wrongNetwork = isConnected && chainId !== ARC.chainId

  return (
    <div className="space-y-5">
      {wrongNetwork && (
        <div
          role="alert"
          className="glass-card flex items-center justify-between gap-3 rounded-2xl p-4"
          style={{ borderColor: 'rgba(154,98,0,0.4)' }}
        >
          <p className="text-sm text-pretty">Your wallet is on a different network. Switch to {ARC.name} to continue.</p>
          <button
            type="button"
            onClick={() => switchChain({ chainId: ARC.chainId })}
            disabled={switching}
            className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-semibold disabled:opacity-50"
          >
            {switching && <Spinner className="size-3.5" />}
            Switch
          </button>
        </div>
      )}

      <section className="glass-card rounded-3xl p-5" aria-label="Totals">
        <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Total received (after fees)
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="display text-4xl font-bold tabular-nums">{isConnected ? fmtUsdc(received) : '0.00'}</span>
          <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>
            USDC
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="glass-inner rounded-2xl p-3">
            <dt className="text-xs" style={{ color: 'var(--muted)' }}>
              Paid
            </dt>
            <dd className="display text-xl font-bold tabular-nums">{paid.length}</dd>
          </div>
          <div className="glass-inner rounded-2xl p-3">
            <dt className="text-xs" style={{ color: 'var(--muted)' }}>
              Pending
            </dt>
            <dd className="display text-xl font-bold tabular-nums">{pending.length}</dd>
          </div>
        </dl>
      </section>

      <CreateInvoice vault={vault} onCreated={bump} />
      <InvoiceList
        vault={vault}
        invoices={data.invoices}
        isConnected={data.isConnected}
        isLoading={data.isLoading}
        isError={data.isError}
        total={data.total}
        shown={data.shown}
        onChanged={bump}
      />
    </div>
  )
}
