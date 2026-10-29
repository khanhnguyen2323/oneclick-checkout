import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { ARC, NETWORK } from '@/config/network'
import { shortAddress } from '@/lib/vault'
import { Link } from '@/components/ui'

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect width="28" height="28" rx="9" fill="#122d45" />
      <path d="M8 15.5 12.2 19.7 20.5 9.5" stroke="#acc6e9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Header() {
  return (
    <header className="flex items-center justify-between gap-3">
      <Link to="/" className="flex items-center gap-2.5">
        <Mark />
        <div>
          <div className="flex items-center gap-1.5">
            <span className="display text-base font-bold leading-none">OneClick Checkout</span>
            {NETWORK.isTestnet && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-[0.08em]"
                style={{ background: 'rgba(154,98,0,0.14)', color: 'var(--warn)' }}
              >
                Testnet
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] font-medium leading-none" style={{ color: 'var(--muted)' }}>
            USDC invoices on {ARC.name}
          </div>
        </div>
      </Link>
      <ConnectKitButton.Custom>
        {({ isConnected, show, address }) => (
          <button
            type="button"
            onClick={show}
            className="btn-primary inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Wallet className="size-3.5" aria-hidden />
            {isConnected && address ? <span className="mono tabular-nums">{shortAddress(address)}</span> : 'Connect'}
          </button>
        )}
      </ConnectKitButton.Custom>
    </header>
  )
}
