import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { ARC } from '@/config/network'
import { VAULT_ABI, fmtUsdc, parseTxError } from '@/lib/vault'
import { writeStored } from '@/lib/paymentTx'

export type ArcStep = 'idle' | 'approve-wallet' | 'approve-confirming' | 'pay-wallet' | 'pay-confirming' | 'done'

/** Approve exactly the invoice amount (only if needed), then pay the invoice on Arc. */
export function useArcPayment(vault: Address, invoiceId: bigint, amount: bigint | undefined, onPaid: () => void) {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: ARC.chainId })
  const [step, setStep] = useState<ArcStep>('idle')
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paidHash, setPaidHash] = useState<string | null>(null)

  const pay = useCallback(async (): Promise<boolean> => {
    if (!client || !address || amount === undefined) return false
    setError(null)
    try {
      if (chainId !== ARC.chainId) await switchChainAsync({ chainId: ARC.chainId })

      const balance = await client.readContract({
        address: ARC.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })
      if (balance < amount) {
        setError(`Not enough USDC on ${ARC.name}. You have ${fmtUsdc(balance)} and need ${fmtUsdc(amount)}.`)
        return false
      }

      const allowance = await client.readContract({
        address: ARC.usdc,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, vault],
      })
      if (allowance < amount) {
        setStep('approve-wallet')
        const approveHash = await writeContractAsync({
          address: ARC.usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [vault, amount],
          chainId: ARC.chainId,
        })
        setStep('approve-confirming')
        const approval = await client.waitForTransactionReceipt({ hash: approveHash })
        if (approval.status !== 'success') throw new Error('Approval reverted')
      }
      setApproved(true)

      setStep('pay-wallet')
      const hash = await writeContractAsync({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'payInvoice',
        args: [invoiceId],
        chainId: ARC.chainId,
      })
      setStep('pay-confirming')
      const receipt = await client.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Payment reverted')
      writeStored('paytx', vault, invoiceId, hash)
      setPaidHash(hash)
      setStep('done')
      onPaid()
      return true
    } catch (e) {
      const message = parseTxError(e)
      if (message) setError(message)
      setStep('idle')
      return false
    }
  }, [client, address, amount, chainId, switchChainAsync, writeContractAsync, vault, invoiceId, onPaid])

  const busy = step !== 'idle' && step !== 'done'
  return { step, approved, error, paidHash, pay, busy }
}
