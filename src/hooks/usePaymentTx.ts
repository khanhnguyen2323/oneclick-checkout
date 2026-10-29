import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Address } from 'viem'
import { ARC } from '@/config/network'
import { findPaymentTx, readStored, writeStored } from '@/lib/paymentTx'

/** Resolves the payment transaction hash of a paid invoice (cached in the browser). */
export function usePaymentTx(vault: Address, id: bigint, paidAt: bigint | undefined) {
  const client = usePublicClient({ chainId: ARC.chainId })
  return useQuery({
    queryKey: ['payment-tx', vault, id.toString()],
    enabled: !!client && paidAt !== undefined && paidAt > 0n,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const cached = readStored('paytx', vault, id)
      if (cached) return cached
      if (!client || paidAt === undefined) return null
      const hash = await findPaymentTx(client, vault, id, paidAt, ARC.vaultDeployBlock)
      if (hash) writeStored('paytx', vault, id, hash)
      return hash
    },
  })
}
