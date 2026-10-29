import { useState } from 'react'
import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { TokenUSDC } from '@web3icons/react'
import { ArrowLeft, CheckCircle2, ExternalLink } from 'lucide-react'
import { ARC, SOURCE, explorerAddress } from '@/config/network'
import { Card, Link, Row, StatusBadge } from '@/components/ui'
import { PayOnArc } from '@/components/PayOnArc'
import { PayFromBase } from '@/components/PayFromBase'
import { navigate } from '@/hooks/useRoute'
import { VAULT_ABI, formatDateTime, fmtUsdc, shortAddress, statusOf } from '@/lib/vault'

type Option = 'arc' | 'base'

const REASON: Record<string, string> = {
  paid: 'This invoice has already been paid.',
  cancelled: 'The merchant cancelled this invoice, so it can no longer be paid.',
  expired: 'This invoice has expired. Ask the merchant for a new one.',
}

export function Pay({ vault, invoiceId }: { vault: Address; invoiceId: bigint | null }) {
  if (invoiceId === null) return <Lookup />
  return <PayInvoice vault={vault} invoiceId={invoiceId} />
}

function Lookup() {
  const [value, setValue] = useState('')
  return (
    <Card>
      <h2 className="display text-xl font-bold">Pay an invoice</h2>
      <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
        Open the payment link you received, or enter the invoice number.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (/^\d{1,18}$/.test(value) && BigInt(value) > 0n) navigate(`/pay/${value}`)
        }}
      >
        <div className="field glass-inner flex min-h-12 flex-1 items-center rounded-2xl px-4 transition-shadow">
          <label htmlFor="invoice-id" className="sr-only">
            Invoice number
          </label>
          <span className="mono mr-1 text-sm" style={{ color: 'var(--subtle)' }}>
            #
          </span>
          <input
            id="invoice-id"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            placeholder="1"
            className="mono w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>
        <button
          type="submit"
          disabled={!value || BigInt(value) === 0n}
          className="btn-primary min-h-12 rounded-2xl px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          Open
        </button>
      </form>
    </Card>
  )
}

function PayInvoice({ vault, invoiceId }: { vault: Address; invoiceId: bigint }) {
  const [option, setOption] = useState<Option>('arc')
  const query = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'getInvoice',
    args: [invoiceId],
    chainId: ARC.chainId,
    query: { refetchInterval: 10_000 },
  })
  const invoice = query.data
  const status = invoice ? statusOf(invoice) : null

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft className="size-4" aria-hidden /> Home
      </Link>

      {query.isLoading ? (
        <div className="glass-card h-80 animate-pulse rounded-3xl" aria-busy="true" />
      ) : query.isError || !invoice || !status ? (
        <Card className="text-center">
          <h2 className="display text-lg font-bold">Invoice #{invoiceId.toString()} not found</h2>
          <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Check the link, and make sure you are on the right network ({ARC.name}).
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden !p-0">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>
                Invoice #{invoiceId.toString()}
              </span>
              <StatusBadge status={status} />
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="display text-5xl font-bold tabular-nums">{fmtUsdc(invoice.amount)}</span>
              <span className="flex items-center gap-1.5 text-base font-semibold" style={{ color: 'var(--subtle)' }}>
                <TokenUSDC variant="branded" size={18} /> USDC
              </span>
            </div>
            {invoice.memo && (
              <p className="mt-2 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
                {invoice.memo}
              </p>
            )}
            <dl className="glass-inner mt-5 space-y-2 rounded-2xl p-4 text-sm tabular-nums">
              <Row label="Pay to">
                <a
                  href={explorerAddress(ARC, invoice.merchant)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono inline-flex items-center gap-1 text-xs"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  {shortAddress(invoice.merchant)} <ExternalLink className="size-3" aria-hidden />
                </a>
              </Row>
              <Row label="Network">{ARC.name}</Row>
              <Row label="Expires">{invoice.expiresAt === 0n ? 'Never' : formatDateTime(invoice.expiresAt)}</Row>
            </dl>
          </div>

          <div className="border-t p-5" style={{ borderColor: 'var(--border)' }}>
            {status === 'unpaid' ? (
              <>
                <div className="glass-inner grid grid-cols-2 gap-1 rounded-2xl p-1" role="tablist" aria-label="Payment method">
                  <OptionTab active={option === 'arc'} onClick={() => setOption('arc')}>
                    USDC on Arc
                  </OptionTab>
                  <OptionTab active={option === 'base'} onClick={() => setOption('base')}>
                    From {SOURCE.name}
                  </OptionTab>
                </div>
                <div className="mt-4">
                  {option === 'arc' ? (
                    <PayOnArc vault={vault} invoice={invoice} onPaid={() => void query.refetch()} />
                  ) : (
                    <PayFromBase vault={vault} invoice={invoice} onPaid={() => void query.refetch()} />
                  )}
                </div>
              </>
            ) : (
              <div className="text-center">
                {status === 'paid' && <CheckCircle2 className="mx-auto mb-2 size-6" style={{ color: 'var(--success)' }} aria-hidden />}
                <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
                  {REASON[status]}
                </p>
                {status === 'paid' && (
                  <Link
                    to={`/receipt/${invoiceId}`}
                    className="btn-primary mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
                  >
                    View receipt
                  </Link>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function OptionTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="min-h-11 rounded-xl px-2 text-xs font-semibold transition-colors"
      style={active ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--ink-2)' }}
    >
      {children}
    </button>
  )
}
