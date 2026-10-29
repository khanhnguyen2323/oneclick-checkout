import { useEffect, useMemo } from 'react'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { ARC } from '@/config/network'
import { VAULT_ABI, type InvoiceData } from '@/lib/vault'

const MAX_LOADED = 50

export function useMerchantInvoices(vault: Address, refreshKey: number) {
  const { address, isConnected } = useAccount()

  const idsQuery = useReadContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: 'getMerchantInvoiceIds',
    args: [address ?? zeroAddress],
    chainId: ARC.chainId,
    query: { enabled: !!address },
  })

  const ids = useMemo(() => [...(idsQuery.data ?? [])].reverse().slice(0, MAX_LOADED), [idsQuery.data])

  const invoicesQuery = useReadContracts({
    contracts: ids.map((id) => ({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'getInvoice' as const,
      args: [id] as const,
      chainId: ARC.chainId,
    })),
    query: { enabled: ids.length > 0 },
  })

  const { refetch: refetchIds } = idsQuery
  const { refetch: refetchInvoices } = invoicesQuery
  useEffect(() => {
    if (refreshKey === 0) return
    void refetchIds().then(() => refetchInvoices())
  }, [refreshKey, refetchIds, refetchInvoices])

  const invoices = useMemo(() => {
    const out: InvoiceData[] = []
    for (const r of invoicesQuery.data ?? []) {
      if (r.status === 'success') out.push(r.result)
    }
    return out
  }, [invoicesQuery.data])

  return {
    isConnected,
    invoices,
    total: idsQuery.data?.length ?? 0,
    shown: ids.length,
    isLoading: idsQuery.isLoading || (ids.length > 0 && invoicesQuery.isLoading),
    isError: idsQuery.isError || invoicesQuery.isError,
  }
}
