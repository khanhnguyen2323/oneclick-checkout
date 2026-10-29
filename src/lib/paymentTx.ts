import type { Address, Hex, PublicClient } from 'viem'
import { parseAbi } from 'viem'

const paidEvent = parseAbi([
  'event InvoicePaid(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 fee)',
])[0]

const key = (kind: 'paytx' | 'burn' | 'bridge', vault: string, id: bigint) => `ocx:${kind}:${vault.toLowerCase()}:${id}`

export function readStored(kind: 'paytx' | 'burn' | 'bridge', vault: string, id: bigint): string | null {
  try {
    return localStorage.getItem(key(kind, vault, id))
  } catch {
    return null
  }
}

export function writeStored(kind: 'paytx' | 'burn' | 'bridge', vault: string, id: bigint, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key(kind, vault, id))
    else localStorage.setItem(key(kind, vault, id), value)
  } catch {
    // storage unavailable: links are simply not remembered
  }
}

/**
 * Finds the transaction that paid an invoice without scanning the chain.
 * `paidAt` is the block timestamp of that transaction, so we locate the block by
 * timestamp (interpolation with a bisect fallback) and read logs in a window of a few hundred blocks.
 */
export async function findPaymentTx(
  client: PublicClient,
  vault: Address,
  id: bigint,
  paidAt: bigint,
  deployBlock: bigint | undefined,
): Promise<Hex | null> {
  const head = await client.getBlock()
  let loB = deployBlock ?? 1n
  const lo = await client.getBlock({ blockNumber: loB })
  let loT = lo.timestamp
  let hiB = head.number
  let hiT = head.timestamp
  if (paidAt > hiT) return null

  let round = 0
  while (hiB - loB > 64n && round < 40) {
    round += 1
    let est: bigint
    if (round % 2 === 1 && hiT > loT && paidAt > loT) {
      est = loB + ((hiB - loB) * (paidAt - loT)) / (hiT - loT)
    } else {
      est = (loB + hiB) / 2n
    }
    if (est <= loB) est = loB + 1n
    if (est >= hiB) est = hiB - 1n
    const blk = await client.getBlock({ blockNumber: est })
    if (blk.timestamp < paidAt) {
      loB = est
      loT = blk.timestamp
    } else {
      hiB = est
      hiT = blk.timestamp
    }
  }

  const toBlock = hiB + 256n > head.number ? head.number : hiB + 256n
  const logs = await client.getLogs({
    address: vault,
    event: paidEvent,
    args: { id },
    fromBlock: loB,
    toBlock,
  })
  return logs[0]?.transactionHash ?? null
}
