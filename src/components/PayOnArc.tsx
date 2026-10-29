import { useAccount, useReadContract } from 'wagmi'
import { useModal } from 'connectkit'
import { erc20Abi, zeroAddress, type Address } from 'viem'
import { ARC } from '@/config/network'
import { ArcSteps } from '@/components/ArcSteps'
import { Spinner } from '@/components/ui'
import { useArcPayment } from '@/hooks/useArcPayment'
import { fmtUsdc, type InvoiceData } from '@/lib/vault'

export function PayOnArc({ vault, invoice, onPaid }: { vault: Address; invoice: InvoiceData; onPaid: () => void }) {
  const { address, isConnected, chainId } = useAccount()
  const { setOpen } = useModal()
  const arc = useArcPayment(vault, invoice.id, invoice.amount, onPaid)
  const balance = useReadContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: ARC.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const insufficient = isConnected && balance.data !== undefined && balance.data < invoice.amount
  const showSteps = arc.busy || arc.step === 'done' || arc.approved

  return (
    <div className="space-y-4">
      {isConnected && (
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: 'var(--muted)' }}>Your USDC on {ARC.name}</span>
          <span className="font-semibold tabular-nums">{balance.data === undefined ? '...' : `${fmtUsdc(balance.data)} USDC`}</span>
        </div>
      )}
      {showSteps && <ArcSteps step={arc.step} approved={arc.approved} />}
      {arc.error && (
        <p role="alert" className="text-sm text-pretty" style={{ color: 'var(--danger)' }}>
          {arc.error}
        </p>
      )}
      {insufficient && !arc.error && (
        <p className="text-sm text-pretty" style={{ color: 'var(--danger)' }}>
          You need {fmtUsdc(invoice.amount)} USDC but have {fmtUsdc(balance.data ?? 0n)}.
          {ARC.chain.testnet && ' Use "Get test USDC" in the Arc Studio sidebar, or pay from Base instead.'}
        </p>
      )}
      <button
        type="button"
        onClick={() => (isConnected ? void arc.pay() : setOpen(true))}
        disabled={arc.busy || (isConnected && insufficient)}
        className="btn-primary min-h-12 w-full rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!isConnected ? (
          'Connect wallet to pay'
        ) : arc.busy ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> {arc.step.endsWith('wallet') ? 'Confirm in wallet...' : 'Confirming...'}
          </span>
        ) : chainId !== ARC.chainId ? (
          `Switch to ${ARC.name} and pay`
        ) : (
          `Pay ${fmtUsdc(invoice.amount)} USDC`
        )}
      </button>
    </div>
  )
}
