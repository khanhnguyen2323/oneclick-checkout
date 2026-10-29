import { useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { X } from 'lucide-react'
import { useShareBase, payLink } from '@/hooks/useShareBase'
import { CopyLinkButton } from '@/components/ui'

export function QrModal({ invoiceId, onClose }: { invoiceId: bigint; onClose: () => void }) {
  const base = useShareBase()
  const link = base ? payLink(base, invoiceId) : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`QR code for invoice ${invoiceId}`}
    >
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-card relative w-full max-w-sm rounded-t-3xl p-6 sm:rounded-3xl" style={{ background: 'rgba(255,255,255,0.95)' }}>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-xl"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        <h3 className="display text-lg font-bold">Invoice #{invoiceId.toString()}</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Scan to open the payment page.
        </p>
        <div className="mx-auto mt-4 flex size-56 items-center justify-center rounded-2xl bg-white p-3" style={{ border: '1px solid var(--border)' }}>
          {link ? <QRCodeSVG value={link} size={208} level="M" /> : <span className="text-sm">Preparing...</span>}
        </div>
        <div className="mono mt-3 break-all text-center text-[11px]" style={{ color: 'var(--ink-2)' }}>
          {link}
        </div>
        <div className="mt-3 flex justify-center">
          <CopyLinkButton invoiceId={invoiceId} label="Copy payment link" />
        </div>
      </div>
    </div>
  )
}
