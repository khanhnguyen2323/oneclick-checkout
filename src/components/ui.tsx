import type { ReactNode } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useShareBase, payLink } from '@/hooks/useShareBase'
import { navigate } from '@/hooks/useRoute'
import type { InvoiceStatus } from '@/lib/vault'

const STATUS_STYLE: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  unpaid: { label: 'Unpaid', color: 'var(--accent-hover)', bg: 'rgba(16,97,166,0.10)' },
  paid: { label: 'Paid', color: 'var(--success)', bg: 'rgba(26,128,71,0.12)' },
  cancelled: { label: 'Cancelled', color: 'var(--muted)', bg: 'rgba(107,101,128,0.14)' },
  expired: { label: 'Expired', color: 'var(--warn)', bg: 'rgba(154,98,0,0.12)' },
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />
}

export function Link({ to, className, style, children }: { to: string; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      style={style}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export function CopyLinkButton({ invoiceId, label = 'Copy link' }: { invoiceId: bigint; label?: string }) {
  const base = useShareBase()
  const onCopy = async () => {
    if (!base) return
    try {
      await navigator.clipboard.writeText(payLink(base, invoiceId))
      toast.success('Payment link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.')
    }
  }
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      disabled={!base}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
      style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
    >
      <Copy className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}

export type StepState = 'todo' | 'active' | 'done' | 'error'

export function Step({ state, label, detail }: { state: StepState; label: string; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            state === 'done' ? 'var(--success)' : state === 'active' ? 'var(--accent)' : state === 'error' ? 'var(--danger)' : 'var(--surface-muted)',
          color: state === 'todo' ? 'var(--subtle)' : '#fff',
        }}
      >
        {state === 'done' ? (
          <Check className="size-3" aria-hidden />
        ) : state === 'active' ? (
          <Spinner className="size-3" />
        ) : state === 'error' ? (
          <X className="size-3" aria-hidden />
        ) : null}
      </span>
      <div className="min-w-0">
        <div className="font-medium" style={{ color: state === 'todo' ? 'var(--subtle)' : 'var(--ink)' }}>
          {label}
        </div>
        {detail && (
          <div className="text-xs" style={{ color: state === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
            {detail}
          </div>
        )}
      </div>
    </li>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass-card rounded-3xl p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt style={{ color: 'var(--muted)' }}>{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
