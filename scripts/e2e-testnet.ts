/**
 * End-to-end check on Arc Testnet: create a 1 USDC invoice, pay it (Option A flow),
 * and verify the exact fee split. Uses throwaway keys kept in /tmp (never printed).
 *
 *   bun scripts/e2e-testnet.ts address   # prints the throwaway payer address to fund
 *   bun scripts/e2e-testnet.ts run
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, parseAbi, parseEventLogs, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const KEYS_PATH = '/tmp/ocx-e2e-keys.json'
const vaultAddress = process.env.VITE_INVOICE_VAULT_ADDRESS_TESTNET as `0x${string}` | undefined
if (!vaultAddress) throw new Error('VITE_INVOICE_VAULT_ADDRESS_TESTNET is not set')

const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
const rpcUrl =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Testnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : arcTestnet.rpcUrls.default.http[0]

const chain = defineChain({ ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } })
const USDC = '0x3600000000000000000000000000000000000000' as const
const abi = parseAbi([
  'function createInvoice(uint256 amount, string memo, uint64 expiresAt) returns (uint256)',
  'function payInvoice(uint256 invoiceId)',
  'function feeRecipient() view returns (address)',
  'function feeBps() view returns (uint16)',
  'function getInvoice(uint256 id) view returns ((uint256 id, address merchant, address payer, uint256 amount, string memo, uint64 createdAt, uint64 expiresAt, uint64 paidAt, uint8 status))',
  'event InvoiceCreated(uint256 indexed id, address indexed merchant, uint256 amount, string memo, uint64 expiresAt)',
  'event InvoicePaid(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 fee)',
])

function loadKeys(): { payer: `0x${string}`; merchant: `0x${string}` } {
  if (existsSync(KEYS_PATH)) return JSON.parse(readFileSync(KEYS_PATH, 'utf8')) as { payer: `0x${string}`; merchant: `0x${string}` }
  const keys = { payer: generatePrivateKey(), merchant: generatePrivateKey() }
  writeFileSync(KEYS_PATH, JSON.stringify(keys), { mode: 0o600 })
  return keys
}

const keys = loadKeys()
const payer = privateKeyToAccount(keys.payer)
const merchant = privateKeyToAccount(keys.merchant)
const pub = createPublicClient({ chain, transport: http() })
const payerWallet = createWalletClient({ account: payer, chain, transport: http() })
const merchantWallet = createWalletClient({ account: merchant, chain, transport: http() })

const balanceOf = (a: `0x${string}`) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
const fmt = (n: bigint) => formatUnits(n, 6)
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) process.exitCode = 1
}

async function send(hash: `0x${string}`) {
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`tx reverted: ${hash}`)
  return receipt
}

async function main() {
  if (process.argv[2] === 'address') {
    console.log(payer.address)
    return
  }

  const amount = parseUnits('1', 6)
  const feeRecipient = await pub.readContract({ address: vaultAddress!, abi, functionName: 'feeRecipient' })
  const feeBps = await pub.readContract({ address: vaultAddress!, abi, functionName: 'feeBps' })
  console.log(`vault ${vaultAddress}  feeBps ${feeBps}  feeRecipient ${feeRecipient}`)

  const payerStart = await balanceOf(payer.address)
  console.log(`payer USDC ${fmt(payerStart)}`)
  if (payerStart < parseUnits('2', 6)) throw new Error('Fund the payer address first (needs at least 2 USDC).')

  // Seed the merchant with a little USDC for gas.
  if ((await balanceOf(merchant.address)) < parseUnits('0.5', 6)) {
    await send(await payerWallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [merchant.address, parseUnits('0.5', 6)] }))
  }

  // 1. Merchant creates a 1 USDC invoice.
  const createReceipt = await send(
    await merchantWallet.writeContract({ address: vaultAddress!, abi, functionName: 'createInvoice', args: [amount, 'E2E test invoice', 0n] }),
  )
  const [created] = parseEventLogs({ abi, eventName: 'InvoiceCreated', logs: createReceipt.logs })
  const id = created.args.id
  console.log(`created invoice #${id}  tx ${createReceipt.transactionHash}`)

  // 2. Snapshot, then payer approves exactly 1 USDC and pays.
  const [merchantBefore, feeBefore, vaultBefore] = await Promise.all([balanceOf(merchant.address), balanceOf(feeRecipient), balanceOf(vaultAddress!)])
  const approveReceipt = await send(await payerWallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [vaultAddress!, amount] }))
  const payReceipt = await send(await payerWallet.writeContract({ address: vaultAddress!, abi, functionName: 'payInvoice', args: [id] }))
  console.log(`approve tx ${approveReceipt.transactionHash}`)
  console.log(`PAYMENT TX ${payReceipt.transactionHash}`)

  const [merchantAfter, feeAfter, vaultAfter] = await Promise.all([balanceOf(merchant.address), balanceOf(feeRecipient), balanceOf(vaultAddress!)])
  const invoice = await pub.readContract({ address: vaultAddress!, abi, functionName: 'getInvoice', args: [id] })
  const [paidEvent] = parseEventLogs({ abi, eventName: 'InvoicePaid', logs: payReceipt.logs })

  ok(merchantAfter - merchantBefore === parseUnits('0.99', 6), `merchant received ${fmt(merchantAfter - merchantBefore)} USDC (expected 0.99)`)
  ok(feeAfter - feeBefore === parseUnits('0.01', 6), `fee recipient received ${fmt(feeAfter - feeBefore)} USDC (expected 0.01)`)
  ok(vaultAfter === 0n && vaultBefore === 0n, 'vault balance is 0')
  ok(invoice.status === 1, 'invoice status is Paid')
  ok(invoice.payer.toLowerCase() === payer.address.toLowerCase(), 'receipt payer matches')
  ok(invoice.paidAt > 0n, `receipt paidAt stored (${invoice.paidAt})`)
  ok(paidEvent.args.fee === parseUnits('0.01', 6) && paidEvent.args.amount === amount, 'InvoicePaid event amount/fee correct')
}

await main()
