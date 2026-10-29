import { useAccount, useReadContract } from 'wagmi'
import { useModal } from 'connectkit'
import { erc20Abi, zeroAddress, type Address } from 'viem'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { ARC, SOURCE, explorerTx } from '@/config/network'
import { ArcSteps } from '@/components/ArcSteps'
import { Spinner, Step } from '@/components/ui'
import { useArcPayment } from '@/hooks/useArcPayment'
import { useBridgePayment } from '@/hooks/useBridgePayment'
import { fmtUsdc, type InvoiceData } from '@/lib/vault'

export function PayFromBase({ vault, invoice, onPaid }: { vault: Address; invoice: InvoiceData; onPaid: () => void }) {
  const { address, isConnected } = useAccount()
  const { setOpen } = useModal()
  const bridge = useBridgePayment(vault, invoice.id)
  const arc = useArcPayment(vault, invoice.id, invoice.amount, onPaid)

  const sourceBalance = useReadContract({
    address: SOURCE.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: SOURCE.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  const arcBalance = useReadContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? zeroAddress],
    chainId: ARC.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const insufficientSource = isConnected && sourceBalance.data !== undefined && sourceBalance.data < invoice.amount
  const noArcGas = isConnected && arcBalance.data !== undefined && arcBalance.data === 0n
  const bridgeRunning = bridge.phase === 'running'
  const bridgeDone = bridge.phase === 'done'
  const started = bridge.phase !== 'idle'
  const busy = bridgeRunning || arc.busy

  const runBridgeThenPay = async () => {
    const ok = await bridge.start(invoice.amount)
    if (ok) await arc.pay()
  }
  const runResume = async () => {
    const ok = await bridge.resume()
    if (ok) await arc.pay()
  }

  const primaryAction = () => {
    if (!isConnected) return setOpen(true)
    if (bridgeDone) return void arc.pay()
    void runBridgeThenPay()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-2xl p-3 text-xs text-pretty" style={{ background: 'rgba(154,98,0,0.10)', color: 'var(--warn)' }}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          You need a little USDC on {ARC.name} for gas, because the transfer is minted to your own wallet and you then
          pay from there. You also need gas on {SOURCE.name}.
          {noArcGas && ` Your ${ARC.name} balance is 0, so add some first.`}
        </span>
      </div>

      {isConnected && (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt style={{ color: 'var(--muted)' }}>USDC on {SOURCE.name}</dt>
            <dd className="font-semibold tabular-nums">{sourceBalance.data === undefined ? '...' : fmtUsdc(sourceBalance.data)}</dd>
          </div>
          <div className="flex justify-between">
            <dt style={{ color: 'var(--muted)' }}>USDC on {ARC.name}</dt>
            <dd className="font-semibold tabular-nums">{arcBalance.data === undefined ? '...' : fmtUsdc(arcBalance.data)}</dd>
          </div>
        </dl>
      )}

      {started && (
        <ol className="space-y-3" aria-label="Bridge steps">
          {bridge.steps.map((s) => (
            <Step
              key={s.name}
              state={s.state === 'pending' ? 'todo' : s.state === 'success' ? 'done' : s.state}
              label={s.label}
              detail={
                s.state === 'error' ? (
                  s.error ?? 'Failed'
                ) : s.txHash ? (
                  <a
                    href={explorerTx(s.name === 'mint' ? ARC : SOURCE, s.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    View transaction <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : undefined
              }
            />
          ))}
        </ol>
      )}
      {bridge.bridgedAmount && started && (
        <p className="text-xs text-pretty" style={{ color: 'var(--muted)' }}>
          Bridging {bridge.bridgedAmount} USDC: the invoice amount plus Circle's transfer fee and a small allowance for gas on{' '}
          {ARC.name}. Any remainder stays in your wallet.
        </p>
      )}
      {bridgeDone && <ArcSteps step={arc.step} approved={arc.approved} />}

      {bridge.phase === 'failed' && bridge.error && (
        <div role="alert" className="rounded-2xl p-3 text-sm text-pretty" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
          {bridge.error}
        </div>
      )}
      {arc.error && (
        <p role="alert" className="text-sm text-pretty" style={{ color: 'var(--danger)' }}>
          {arc.error}
        </p>
      )}
      {insufficientSource && !started && (
        <p className="text-sm text-pretty" style={{ color: 'var(--danger)' }}>
          You need at least {fmtUsdc(invoice.amount)} USDC on {SOURCE.name}, but have {fmtUsdc(sourceBalance.data ?? 0n)}.
        </p>
      )}

      {bridge.phase === 'failed' && bridge.canResume ? (
        <button
          type="button"
          onClick={() => void runResume()}
          disabled={busy}
          className="btn-primary min-h-12 w-full rounded-2xl text-sm font-semibold disabled:opacity-40"
        >
          Resume transfer
        </button>
      ) : (
        <button
          type="button"
          onClick={primaryAction}
          disabled={busy || (isConnected && insufficientSource && !bridgeDone)}
          className="btn-primary min-h-12 w-full rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {!isConnected ? (
            'Connect wallet to pay'
          ) : busy ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner /> {bridgeRunning ? 'Bridging...' : arc.step.endsWith('wallet') ? 'Confirm in wallet...' : 'Confirming...'}
            </span>
          ) : bridgeDone ? (
            `Pay ${fmtUsdc(invoice.amount)} USDC on ${ARC.name}`
          ) : (
            `Bridge from ${SOURCE.name} and pay`
          )}
        </button>
      )}
    </div>
  )
}
