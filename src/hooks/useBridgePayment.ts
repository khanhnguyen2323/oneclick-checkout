import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import type { Address } from 'viem'
import { ARC, SOURCE } from '@/config/network'
import { appKit, createAdapter, type BridgeAdapter, type BridgeResult } from '@/lib/bridge'
import { readStored, writeStored } from '@/lib/paymentTx'
import { parseTxError } from '@/lib/vault'
import { Amount, formatUsdc, gasTokenDecimalsFor, gasTokenToUsdc } from '@/onchain-money'

/** Generous gas allowance for approve + payInvoice on Arc (two transactions). */
const PAY_GAS_LIMIT = 500_000n

export type BridgeStepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'
export type BridgeStepState = 'pending' | 'active' | 'success' | 'error'

export interface BridgeUiStep {
  name: BridgeStepName
  label: string
  state: BridgeStepState
  txHash?: string
  error?: string
}

const ORDER: BridgeStepName[] = ['approve', 'burn', 'fetchAttestation', 'mint']
const LABELS: Record<BridgeStepName, string> = {
  approve: `Approve on ${SOURCE.name}`,
  burn: `Burn on ${SOURCE.name}`,
  fetchAttestation: 'Waiting for attestation',
  mint: `Mint on ${ARC.name}`,
}
const EVENTS = ['bridge.approve', 'bridge.burn', 'bridge.fetchAttestation', 'bridge.mint'] as const

const fresh = (): BridgeUiStep[] => ORDER.map((name) => ({ name, label: LABELS[name], state: 'pending' }))

const isStepName = (name: string): name is BridgeStepName => (ORDER as string[]).includes(name)

function stepError(error: unknown): string {
  if (typeof error === 'string') return error
  const message = (error as { message?: string } | null)?.message
  return message ?? 'The step failed.'
}

export type BridgePhase = 'idle' | 'running' | 'failed' | 'done'

/** Bridges USDC from the source chain to the SAME wallet on Arc with Circle Bridge Kit (CCTP V2). */
export function useBridgePayment(vault: Address, invoiceId: bigint) {
  const { connector, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const arcClient = usePublicClient({ chainId: ARC.chainId })
  const [steps, setSteps] = useState<BridgeUiStep[]>(fresh)
  const [phase, setPhase] = useState<BridgePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [burnHash, setBurnHash] = useState<string | null>(() => readStored('burn', vault, invoiceId))
  const [bridgedAmount, setBridgedAmount] = useState<string | null>(null)
  const resultRef = useRef<BridgeResult | null>(null)
  const [canResume, setCanResume] = useState(false)

  // Restore a failed transfer from this browser so it can be resumed after a reload.
  useEffect(() => {
    const stored = readStored('bridge', vault, invoiceId)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as BridgeResult
      resultRef.current = parsed
      applyResult(parsed, false)
      setPhase('failed')
      setCanResume(true)
    } catch {
      writeStored('bridge', vault, invoiceId, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, invoiceId])

  // Live progress from Bridge Kit events (each fires when its step completes).
  useEffect(() => {
    const handlers = EVENTS.map((evt) => {
      const name = evt.replace('bridge.', '') as BridgeStepName
      const handler = () => {
        setSteps((prev) => {
          const idx = ORDER.indexOf(name)
          return prev.map((s, i) =>
            i <= idx ? { ...s, state: 'success' } : i === idx + 1 ? { ...s, state: 'active' } : s,
          )
        })
      }
      appKit.on(evt, handler)
      return { evt, handler }
    })
    return () => {
      for (const { evt, handler } of handlers) appKit.off(evt, handler)
    }
  }, [])

  function applyResult(result: BridgeResult, running: boolean) {
    setSteps((prev) => {
      const next = prev.map((s) => ({ ...s }))
      for (const step of result.steps) {
        if (!isStepName(step.name)) continue
        const target = next[ORDER.indexOf(step.name)]
        target.txHash = step.txHash ?? target.txHash
        if (step.state === 'success') target.state = 'success'
        else if (step.state === 'error') {
          target.state = 'error'
          target.error = stepError(step.error)
        }
      }
      if (running) {
        const firstOpen = next.find((s) => s.state === 'pending')
        if (firstOpen) firstOpen.state = 'active'
      }
      return next
    })
    const burn = result.steps.find((s) => s.name === 'burn' && s.state === 'success')
    if (burn?.txHash) {
      setBurnHash(burn.txHash)
      writeStored('burn', vault, invoiceId, burn.txHash)
    }
  }

  const finish = useCallback(
    (result: BridgeResult): boolean => {
      resultRef.current = result
      applyResult(result, false)
      if (result.state === 'success') {
        writeStored('bridge', vault, invoiceId, null)
        setCanResume(false)
        setPhase('done')
        return true
      }
      try {
        writeStored('bridge', vault, invoiceId, JSON.stringify(result, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
      } catch {
        // resume still works from memory
      }
      const failed = result.steps.find((s) => s.state === 'error')
      setError(failed ? stepError(failed.error) : 'The transfer did not complete.')
      setCanResume(true)
      setPhase('failed')
      return false
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, invoiceId],
  )

  const adapterFor = useCallback(async (): Promise<BridgeAdapter> => {
    if (!connector) throw new Error('Wallet not connected')
    return createAdapter(await connector.getProvider())
  }, [connector])

  /** Bridges `invoiceAmount` plus Circle's transfer fee so the net mint covers the invoice. */
  const start = useCallback(
    async (invoiceAmount: bigint): Promise<boolean> => {
      setError(null)
      setSteps(fresh())
      setPhase('running')
      try {
        if (chainId !== SOURCE.chainId) await switchChainAsync({ chainId: SOURCE.chainId })
        const adapter = await adapterFor()
        const route = {
          from: { adapter, chain: SOURCE.bridgeKitName },
          to: { adapter, chain: ARC.bridgeKitName },
        }

        let fee = 0n
        try {
          const est = await appKit.estimateBridge({ ...route, amount: formatUsdc(invoiceAmount) })
          for (const f of est.fees) {
            if (f.token === 'USDC' && f.amount) fee += Amount.parse(f.amount, ARC.usdcDecimals).raw
          }
        } catch {
          // fall back to the bare invoice amount; the Arc balance check reports any shortfall
        }
        // Gas on Arc is paid in USDC from the same balance, so also bridge enough to cover the
        // approve + pay transactions that follow the mint (converted with the shared helper).
        let gasBuffer = 0n
        try {
          const gasPrice = await arcClient?.getGasPrice()
          if (gasPrice !== undefined) {
            const native = Amount.fromRaw(gasPrice * PAY_GAS_LIMIT, gasTokenDecimalsFor(ARC.chainId))
            gasBuffer = gasTokenToUsdc(ARC.chainId, native, 'trunc').raw + 1n
          }
        } catch {
          // the Arc balance check after the mint reports any shortfall
        }
        const amount = formatUsdc(invoiceAmount + fee * 2n + gasBuffer)
        setBridgedAmount(amount)
        setSteps((prev) => prev.map((s, i) => (i === 0 ? { ...s, state: 'active' } : s)))

        const result = await appKit.bridge({ ...route, amount })
        return finish(result)
      } catch (e) {
        setSteps((prev) => {
          const active = prev.findIndex((s) => s.state === 'active')
          return prev.map((s, i) => (i === active ? { ...s, state: 'error' } : s))
        })
        const message = parseTxError(e)
        setError(message ?? 'You cancelled the request in your wallet.')
        setPhase('failed')
        return false
      }
    },
    [chainId, switchChainAsync, adapterFor, finish, arcClient],
  )

  /** Resumes from the failed step; never restarts the transfer from scratch. */
  const resume = useCallback(async (): Promise<boolean> => {
    const previous = resultRef.current
    if (!previous) return false
    setError(null)
    setPhase('running')
    try {
      const failed = previous.steps.find((s) => s.state === 'error')
      if (failed && (failed.name === 'approve' || failed.name === 'burn') && chainId !== SOURCE.chainId) {
        await switchChainAsync({ chainId: SOURCE.chainId })
      }
      const adapter = await adapterFor()
      const result = await appKit.retryBridge(previous, { from: adapter, to: adapter })
      return finish(result)
    } catch (e) {
      setError(parseTxError(e) ?? 'You cancelled the request in your wallet.')
      setPhase('failed')
      return false
    }
  }, [chainId, switchChainAsync, adapterFor, finish])

  return { steps, phase, error, burnHash, bridgedAmount, canResume, start, resume }
}
