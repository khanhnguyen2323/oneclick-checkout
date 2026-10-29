import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { ArrowLeft, CheckCircle2, ExternalLink } from 'lucide-react'
import { ARC, SOURCE, explorerAddress, explorerTx } from '@/config/network'
import { Card, Link, Row, StatusBadge } from '@/components/ui'
import { useFeeBps } from '@/hooks/useFeeBps'
import { usePaymentTx } from '@/hooks/usePaymentTx'
import { readStored } from '@/lib/paymentTx'
import { VAULT_ABI, feeFor, fmtUsdc, formatDateTime, shortAddress, statusOf } from '@/lib/vault'

export function Receipt({ vault, invoiceId }: { vault: Address; invoiceId: bigint | null }) {
  if (invoiceId === null) {
    return (
      <Card className="text-center">
        <h2 className="display text-lg font-bold">Receipt not found</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Use a link like /receipt/1.
        </p>
      </Card>
    )
  }
  return <ReceiptView vault={vault} invoiceId={invoiceId} />
}

function ReceiptView({ vault, invoiceId }: { vault: Address; invoiceId: bigint }) {
  const query = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'getInvoice',
    args: [invoiceId],
    chainId: ARC.chainId,
  })
  const { data: feeBps } = useFeeBps(vault)
  const invoice = query.data
  const status = invoice ? statusOf(invoice) : null
  const tx = usePaymentTx(vault, invoiceId, status === 'paid' ? invoice?.paidAt : undefined)
  const burnHash = readStored('burn', vault, invoiceId)
  const fee = invoice && feeBps !== undefined ? feeFor(invoice.amount, BigInt(feeBps)) : null

  return (
    <div className="space-y-4">
      <Link to={`/pay/${invoiceId}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft className="size-4" aria-hidden /> Invoice
      </Link>

      {query.isLoading ? (
        <div className="glass-card h-80 animate-pulse rounded-3xl" aria-busy="true" />
      ) : query.isError || !invoice || !status ? (
        <Card className="text-center">
          <h2 className="display text-lg font-bold">Invoice #{invoiceId.toString()} not found</h2>
        </Card>
      ) : status !== 'paid' ? (
        <Card className="text-center">
          <h2 className="display text-lg font-bold">No receipt yet</h2>
          <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
            Invoice #{invoiceId.toString()} is <StatusBadge status={status} />. A receipt appears once it is paid.
          </p>
          <Link to={`/pay/${invoiceId}`} className="btn-primary mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
            Open invoice
          </Link>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2" style={{ color: 'var(--success)' }}>
            <CheckCircle2 className="size-5" aria-hidden />
            <h2 className="display text-lg font-bold">Payment receipt</h2>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="display text-4xl font-bold tabular-nums">{fmtUsdc(invoice.amount)}</span>
            <span className="text-base font-medium" style={{ color: 'var(--subtle)' }}>
              USDC
            </span>
          </div>
          {invoice.memo && (
            <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
              {invoice.memo}
            </p>
          )}

          <dl className="glass-inner mt-4 space-y-2 rounded-2xl p-4 text-sm tabular-nums">
            <Row label="Invoice">#{invoiceId.toString()}</Row>
            <Row label="Merchant">
              <a href={explorerAddress(ARC, invoice.merchant)} target="_blank" rel="noopener noreferrer" className="mono text-xs" style={{ color: 'var(--accent-hover)' }}>
                {shortAddress(invoice.merchant)}
              </a>
            </Row>
            <Row label="Paid by">
              <a href={explorerAddress(ARC, invoice.payer)} target="_blank" rel="noopener noreferrer" className="mono text-xs" style={{ color: 'var(--accent-hover)' }}>
                {shortAddress(invoice.payer)}
              </a>
            </Row>
            <Row label="Paid at">{formatDateTime(invoice.paidAt)}</Row>
            {fee !== null && (
              <>
                <Row label={`Platform fee (${Number(feeBps) / 100}%)`}>{fmtUsdc(fee)} USDC</Row>
                <Row label="Merchant received">{fmtUsdc(invoice.amount - fee)} USDC</Row>
              </>
            )}
            <Row label="Network">{ARC.name}</Row>
          </dl>

          <div className="mt-4 space-y-1">
            {tx.data ? (
              <ExplorerLink href={explorerTx(ARC, tx.data)}>Payment transaction on {ARC.name}</ExplorerLink>
            ) : tx.isLoading ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Finding the payment transaction...
              </p>
            ) : null}
            {burnHash && <ExplorerLink href={explorerTx(SOURCE, burnHash)}>Burn transaction on {SOURCE.name}</ExplorerLink>}
          </div>
        </Card>
      )}
    </div>
  )
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 items-center gap-1.5 text-sm font-semibold"
      style={{ color: 'var(--accent-hover)' }}
    >
      {children} <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}
