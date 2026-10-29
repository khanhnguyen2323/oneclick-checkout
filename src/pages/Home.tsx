import { ArrowRight, Globe2, QrCode, ShieldCheck } from 'lucide-react'
import { Link } from '@/components/ui'

export function Home() {
  return (
    <div className="space-y-6">
      <section className="glass-card rounded-3xl p-6">
        <h1 className="display text-balance text-3xl font-bold leading-tight">Get paid in USDC on Arc, from any chain</h1>
        <p className="mt-2 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Create an invoice, share a link or QR code, and get paid directly. Customers pay with USDC already on Arc, or
          bridge from another chain in the same flow.
        </p>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <Link
            to="/merchant"
            className="btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Create invoice <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            to="/pay"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
          >
            Pay an invoice
          </Link>
        </div>
      </section>

      <ul className="space-y-2.5">
        <Feature icon={<ShieldCheck className="size-4" />} title="Paid directly">
          Funds go from the customer to you in one transaction. A small platform fee is split off automatically.
        </Feature>
        <Feature icon={<Globe2 className="size-4" />} title="Pay from another chain">
          Circle Bridge Kit moves USDC to the customer's own wallet on Arc, then pays the invoice.
        </Feature>
        <Feature icon={<QrCode className="size-4" />} title="Link and QR code">
          Share one link per invoice and track every payment with an onchain receipt.
        </Feature>
      </ul>
    </div>
  )
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="glass-inner flex gap-3 rounded-2xl p-4">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)' }}>
        {icon}
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {children}
        </p>
      </div>
    </li>
  )
}
