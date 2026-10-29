import { useEffect, useMemo, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useModal } from 'connectkit'
import { parseEventLogs, type Address } from 'viem'
import { TokenUSDC } from '@web3icons/react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { ARC, explorerTx } from '@/config/network'
import { parseAmount } from '@/onchain-money'
import { useFeeBps } from '@/hooks/useFeeBps'
import { useShareBase, payLink } from '@/hooks/useShareBase'
import { Card, CopyLinkButton, Link, SectionTitle, Spinner } from '@/components/ui'
import { MAX_MEMO_BYTES, VAULT_ABI, feeFor, fmtUsdc, parseTxError } from '@/lib/vault'

interface Created {
  id: bigint
  hash: string
}

/** Local `YYYY-MM-DDTHH:mm` for the datetime-local input's min value. */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function CreateInvoice({ vault, onCreated }: { vault: Address; onCreated: () => void }) {
  const { isConnected, chainId } = useAccount()
  const { setOpen } = useModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: ARC.chainId })
  const { data: feeBps } = useFeeBps(vault)
  const shareBase = useShareBase()

  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [expiry, setExpiry] = useState('')
  const [phase, setPhase] = useState<'idle' | 'wallet' | 'confirming'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const raw = useMemo(() => {
    if (!amount) return null
    try {
      const parsed = parseAmount(ARC.chainId, amount).raw
      return parsed > 0n ? parsed : null
    } catch {
      return null
    }
  }, [amount])

  const memoBytes = new TextEncoder().encode(memo).length
  const memoTooLong = memoBytes > MAX_MEMO_BYTES
  const expirySec = expiry ? Math.floor(new Date(expiry).getTime() / 1000) : 0
  const expiryInvalid = expiry !== '' && (Number.isNaN(expirySec) || expirySec <= Math.floor(now / 1000) + 30)
  const fee = raw !== null && feeBps !== undefined ? feeFor(raw, BigInt(feeBps)) : null
  const busy = phase !== 'idle'
  const canSubmit = raw !== null && !memoTooLong && !expiryInvalid && !busy

  const submit = async () => {
    if (!isConnected) {
      setOpen(true)
      return
    }
    if (raw === null || !publicClient) return
    setError(null)
    try {
      if (chainId !== ARC.chainId) await switchChainAsync({ chainId: ARC.chainId })
      setPhase('wallet')
      const hash = await writeContractAsync({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'createInvoice',
        args: [raw, memo.trim(), BigInt(expirySec)],
        chainId: ARC.chainId,
      })
      setPhase('confirming')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('reverted')
      const [log] = parseEventLogs({ abi: VAULT_ABI, eventName: 'InvoiceCreated', logs: receipt.logs })
      if (!log) throw new Error('InvoiceCreated event missing')
      setCreated({ id: log.args.id, hash })
      setAmount('')
      setMemo('')
      setExpiry('')
      onCreated()
    } catch (e) {
      const message = parseTxError(e)
      if (message) setError(message)
    } finally {
      setPhase('idle')
    }
  }

  if (created) {
    const link = shareBase ? payLink(shareBase, created.id) : null
    return (
      <Card>
        <div className="flex items-center gap-2" style={{ color: 'var(--success)' }}>
          <CheckCircle2 className="size-5" aria-hidden />
          <h2 className="display text-lg font-bold">Invoice #{created.id.toString()} created</h2>
        </div>
        <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Share this link or QR code. Customers can pay with USDC on {ARC.name} or from another chain.
        </p>
        <div className="glass-inner mono mt-4 break-all rounded-2xl p-3 text-xs" style={{ color: 'var(--ink-2)' }}>
          {link ?? 'Preparing link...'}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyLinkButton invoiceId={created.id} label="Copy payment link" />
          <Link to={`/pay/${created.id}`} className="inline-flex min-h-11 items-center px-3 text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
            Open pay page
          </Link>
          <a
            href={explorerTx(ARC, created.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 px-3 text-xs font-semibold"
            style={{ color: 'var(--accent-hover)' }}
          >
            Transaction <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <button type="button" onClick={() => setCreated(null)} className="ml-auto min-h-11 rounded-xl px-3 text-xs font-semibold">
            New invoice
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <SectionTitle>New invoice</SectionTitle>

      <div className="field glass-inner mt-3 rounded-2xl p-4 transition-shadow">
        <label htmlFor="amount" className="sr-only">
          Amount in USDC
        </label>
        <div className="flex items-center gap-2">
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (v === '' || new RegExp(`^\\d*\\.?\\d{0,${ARC.usdcDecimals}}$`).test(v)) setAmount(v)
            }}
            placeholder="0.00"
            className="display w-full min-w-0 bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
          />
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--subtle)' }}>
            <TokenUSDC variant="branded" size={20} /> USDC
          </span>
        </div>
      </div>

      <div className="field glass-inner mt-3 rounded-2xl px-4 py-3 transition-shadow">
        <label htmlFor="memo" className="sr-only">
          Memo
        </label>
        <input
          id="memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="What is this for? (optional)"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        <div className="mt-1 text-right text-[11px] tabular-nums" style={{ color: memoTooLong ? 'var(--danger)' : 'var(--subtle)' }}>
          {memoBytes}/{MAX_MEMO_BYTES}
        </div>
      </div>

      <div className="field glass-inner mt-3 rounded-2xl px-4 py-3 transition-shadow">
        <label htmlFor="expiry" className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Expires (optional)
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="expiry"
            type="datetime-local"
            min={localInputValue(new Date(now))}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="min-h-9 w-full bg-transparent text-sm outline-none"
          />
          {expiry && (
            <button type="button" onClick={() => setExpiry('')} className="min-h-11 shrink-0 px-2 text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>
              Clear
            </button>
          )}
        </div>
        {expiryInvalid && (
          <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
            Pick a time in the future.
          </p>
        )}
      </div>

      {raw !== null && fee !== null && (
        <dl className="mt-4 space-y-1.5 text-sm tabular-nums">
          <div className="flex justify-between">
            <dt style={{ color: 'var(--muted)' }}>Platform fee ({Number(feeBps) / 100}%)</dt>
            <dd>{fmtUsdc(fee)} USDC</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>You receive</dt>
            <dd>{fmtUsdc(raw - fee)} USDC</dd>
          </div>
        </dl>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={isConnected && !canSubmit}
        className="btn-primary mt-4 min-h-12 w-full rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!isConnected ? (
          'Connect wallet'
        ) : phase === 'wallet' ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> Confirm in wallet...
          </span>
        ) : phase === 'confirming' ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> Creating invoice...
          </span>
        ) : (
          'Create invoice'
        )}
      </button>
    </Card>
  )
}
