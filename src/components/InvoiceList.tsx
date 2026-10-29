import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import type { Address } from 'viem'
import { ExternalLink, FileText, QrCode, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { ARC, explorerTx } from '@/config/network'
import { usePaymentTx } from '@/hooks/usePaymentTx'
import { Card, CopyLinkButton, Link, SectionTitle, Spinner, StatusBadge } from '@/components/ui'
import { QrModal } from '@/components/QrModal'
import { VAULT_ABI, fmtUsdc, formatDateTime, parseTxError, shortAddress, statusOf, type InvoiceData } from '@/lib/vault'

export function InvoiceList({
  vault,
  invoices,
  isConnected,
  isLoading,
  isError,
  total,
  shown,
  onChanged,
}: {
  vault: Address
  invoices: InvoiceData[]
  isConnected: boolean
  isLoading: boolean
  isError: boolean
  total: number
  shown: number
  onChanged: () => void
}) {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: ARC.chainId })
  const [cancelling, setCancelling] = useState<bigint | null>(null)
  const [qrFor, setQrFor] = useState<bigint | null>(null)

  const cancel = async (id: bigint) => {
    if (!client) return
    setCancelling(id)
    try {
      if (chainId !== ARC.chainId) await switchChainAsync({ chainId: ARC.chainId })
      const hash = await writeContractAsync({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'cancelInvoice',
        args: [id],
        chainId: ARC.chainId,
      })
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('reverted')
      toast.success(`Invoice #${id.toString()} cancelled`)
      onChanged()
    } catch (e) {
      const message = parseTxError(e)
      if (message) toast.error(message)
    } finally {
      setCancelling(null)
    }
  }

  return (
    <Card>
      <SectionTitle>Your invoices</SectionTitle>
      {!isConnected ? (
        <Empty text="Connect your wallet to see your invoices." />
      ) : isLoading ? (
        <div className="mt-4 space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
      ) : isError ? (
        <Empty text="Could not load invoices. Check your connection and try again." />
      ) : invoices.length === 0 ? (
        <Empty text="No invoices yet. Create your first one above." />
      ) : (
        <>
          <ul className="mt-3 space-y-2.5">
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id.toString()}
                vault={vault}
                inv={inv}
                cancelling={cancelling}
                onCancel={() => void cancel(inv.id)}
                onQr={() => setQrFor(inv.id)}
              />
            ))}
          </ul>
          {total > shown && (
            <p className="mt-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
              Showing your latest {shown} of {total} invoices.
            </p>
          )}
        </>
      )}
      {qrFor !== null && <QrModal invoiceId={qrFor} onClose={() => setQrFor(null)} />}
    </Card>
  )
}

function InvoiceRow({
  vault,
  inv,
  cancelling,
  onCancel,
  onQr,
}: {
  vault: Address
  inv: InvoiceData
  cancelling: bigint | null
  onCancel: () => void
  onQr: () => void
}) {
  const status = statusOf(inv)
  const tx = usePaymentTx(vault, inv.id, status === 'paid' ? inv.paidAt : undefined)

  return (
    <li className="glass-inner rounded-2xl p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>
              #{inv.id.toString()}
            </span>
            <StatusBadge status={status} />
          </div>
          <div className="mt-1 truncate text-sm font-medium">{inv.memo || 'No memo'}</div>
          <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            Created {formatDateTime(inv.createdAt)}
            {inv.expiresAt !== 0n && status === 'unpaid' && ` · Expires ${formatDateTime(inv.expiresAt)}`}
          </div>
          {status === 'paid' && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span>
                Paid by <span className="mono">{shortAddress(inv.payer)}</span>
              </span>
              {tx.data ? (
                <a
                  href={explorerTx(ARC, tx.data)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  Payment tx <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : tx.isLoading ? (
                <span>Finding tx...</span>
              ) : null}
            </div>
          )}
        </div>
        <span className="display shrink-0 text-lg font-bold tabular-nums">{fmtUsdc(inv.amount)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {status === 'unpaid' && (
          <>
            <CopyLinkButton invoiceId={inv.id} />
            <button
              type="button"
              onClick={onQr}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
              style={{ background: 'var(--surface-muted)' }}
            >
              <QrCode className="size-3.5" aria-hidden /> QR code
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling !== null}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold disabled:opacity-40"
              style={{ color: 'var(--danger)' }}
            >
              {cancelling === inv.id && <Spinner className="size-3.5" />}
              Cancel
            </button>
          </>
        )}
        {status === 'paid' && (
          <Link
            to={`/receipt/${inv.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
            style={{ background: 'var(--surface-muted)' }}
          >
            <Receipt className="size-3.5" aria-hidden /> Receipt
          </Link>
        )}
      </div>
    </li>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl py-8 text-center" style={{ background: 'var(--surface-muted)' }}>
      <FileText className="size-5" style={{ color: 'var(--subtle)' }} aria-hidden />
      <p className="max-w-[16rem] text-sm text-pretty" style={{ color: 'var(--muted)' }}>
        {text}
      </p>
    </div>
  )
}
