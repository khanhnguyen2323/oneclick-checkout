import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { ARC } from '@/config/network'
import { VAULT_ABI } from '@/lib/vault'

/** Platform fee in basis points, read live from the vault. */
export function useFeeBps(vault: Address) {
  return useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'feeBps',
    chainId: ARC.chainId,
  })
}
