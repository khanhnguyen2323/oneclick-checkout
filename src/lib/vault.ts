import { parseAbi, type Address } from 'viem'
import { ARC } from '@/config/network'
import { Amount, formatUnitsFixed } from '@/onchain-money'

export const VAULT_ABI = parseAbi([
  'struct InvoiceView { uint256 id; address merchant; address payer; uint256 amount; string memo; uint64 createdAt; uint64 expiresAt; uint64 paidAt; uint8 status; }',
  'function createInvoice(uint256 amount, string memo, uint64 expiresAt) returns (uint256 invoiceId)',
  'function payInvoice(uint256 invoiceId)',
  'function cancelInvoice(uint256 invoiceId)',
  'function getInvoice(uint256 id) view returns (InvoiceView)',
  'function getMerchantInvoiceIds(address merchant) view returns (uint256[])',
  'function invoiceCount() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function feeRecipient() view returns (address)',
  'event InvoiceCreated(uint256 indexed id, address indexed merchant, uint256 amount, string memo, uint64 expiresAt)',
  'event InvoicePaid(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 fee)',
  'event InvoiceCancelled(uint256 indexed id)',
])

export const MAX_MEMO_BYTES = 140

export type InvoiceStatus = 'unpaid' | 'paid' | 'cancelled' | 'expired'

const STATUS_BY_INDEX: InvoiceStatus[] = ['unpaid', 'paid', 'cancelled', 'expired']

export interface InvoiceData {
  id: bigint
  merchant: Address
  payer: Address
  amount: bigint
  memo: string
  createdAt: bigint
  expiresAt: bigint
  paidAt: bigint
  status: number
}

/** Status is computed by the contract; this only maps its enum to a label. */
export function statusOf(inv: Pick<InvoiceData, 'status'>): InvoiceStatus {
  return STATUS_BY_INDEX[inv.status] ?? 'unpaid'
}

/** Formats a raw USDC amount (6-decimal ERC-20 view) with 2 to 6 decimals. */
export function fmtUsdc(raw: bigint): string {
  const six = formatUnitsFixed(Amount.fromRaw(raw, ARC.usdcDecimals).raw, ARC.usdcDecimals, ARC.usdcDecimals).replace(
    /0+$/,
    '',
  )
  const [whole, frac = ''] = six.split('.')
  return `${Number(whole).toLocaleString('en-US')}.${frac.padEnd(2, '0')}`
}

export function feeFor(amount: bigint, feeBps: bigint): bigint {
  return (amount * feeBps) / 10_000n
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatDateTime(sec: bigint): string {
  return new Date(Number(sec) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ERROR_MAP: Array<[string, string]> = [
  ['InvoiceExpired', 'This invoice has expired.'],
  ['InvoiceAlreadyPaid', 'This invoice is already paid.'],
  ['InvoiceAlreadyCancelled', 'This invoice was cancelled.'],
  ['InvoiceNotFound', 'Invoice not found.'],
  ['NotMerchant', 'Only the merchant can do that.'],
  ['InvalidExpiry', 'Expiry must be in the future.'],
  ['MemoTooLong', `Memo is too long (${MAX_MEMO_BYTES} bytes max).`],
  ['insufficient allowance', 'USDC allowance is too low. Try again to approve it first.'],
  ['transfer amount exceeds balance', 'Not enough USDC in your wallet.'],
  ['exceeds balance', 'Not enough USDC in your wallet.'],
  ['insufficient funds', 'Not enough USDC on this network to cover gas.'],
  ['chain mismatch', 'Your wallet is on the wrong network. Switch networks and retry.'],
  ['network', 'Network issue. Check your connection and retry.'],
  ['timeout', 'The request timed out. Retry in a moment.'],
]

/** Returns a human-readable message, or null when the user simply rejected the request. */
export function parseTxError(error: unknown): string | null {
  const err = error as { message?: string; code?: number; shortMessage?: string; cause?: { code?: number } } | null
  const lower = `${err?.shortMessage ?? ''} ${err?.message ?? ''}`.toLowerCase()
  if (err?.code === 4001 || err?.cause?.code === 4001 || lower.includes('user rejected') || lower.includes('user denied'))
    return null
  for (const [needle, text] of ERROR_MAP) {
    if (lower.includes(needle.toLowerCase())) return text
  }
  if (lower.includes('reverted')) return 'The contract rejected the transaction.'
  return 'Something went wrong. Please try again.'
}
