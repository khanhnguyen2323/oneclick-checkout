import { Header } from '@/components/Header'
import { Card, Link } from '@/components/ui'
import { useRoute } from '@/hooks/useRoute'
import { ARC, NETWORK } from '@/config/network'
import { Home } from '@/pages/Home'
import { Merchant } from '@/pages/Merchant'
import { Pay } from '@/pages/Pay'
import { Receipt } from '@/pages/Receipt'

export default function App() {
  const route = useRoute()
  const vault = ARC.vault

  return (
    <div className="min-h-dvh px-4 pb-24 pt-5">
      <div className="mx-auto max-w-md space-y-5">
        <Header />

        {route.name === 'home' ? (
          <Home />
        ) : !vault ? (
          <Card>
            <h2 className="display text-lg font-bold">Contract not configured</h2>
            <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
              Set VITE_INVOICE_VAULT_ADDRESS_{NETWORK.name.toUpperCase()} to the deployed InvoiceVault on {ARC.name} and
              restart the dev server.
            </p>
          </Card>
        ) : route.name === 'merchant' ? (
          <Merchant vault={vault} />
        ) : route.name === 'pay' ? (
          <Pay vault={vault} invoiceId={route.id} />
        ) : route.name === 'receipt' ? (
          <Receipt vault={vault} invoiceId={route.id} />
        ) : (
          <Card className="text-center">
            <h2 className="display text-lg font-bold">Page not found</h2>
            <Link to="/" className="btn-primary mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold">
              Go home
            </Link>
          </Card>
        )}
      </div>
    </div>
  )
}
