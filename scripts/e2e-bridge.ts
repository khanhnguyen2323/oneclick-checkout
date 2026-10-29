/**
 * Testnet check of Option B: bridge USDC Base Sepolia -> Arc Testnet to the SAME wallet with
 * Circle Bridge Kit (CCTP V2), then create and pay an invoice on Arc. Throwaway keys from
 * /tmp/ocx-e2e-keys.json (created by scripts/e2e-testnet.ts). Never prints keys.
 *
 *   bun scripts/e2e-bridge.ts
 */
import { readFileSync } from 'node:fs'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, parseAbi, parseEventLogs, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const vault = process.env.VITE_INVOICE_VAULT_ADDRESS_TESTNET as `0x${string}` | undefined
if (!vault) throw new Error('VITE_INVOICE_VAULT_ADDRESS_TESTNET is not set')
const keys = JSON.parse(readFileSync('/tmp/ocx-e2e-keys.json', 'utf8')) as { payer: `0x${string}`; merchant: `0x${string}` }
const payer = privateKeyToAccount(keys.payer)
const merchant = privateKeyToAccount(keys.merchant)

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
  'event InvoiceCreated(uint256 indexed id, address indexed merchant, uint256 amount, string memo, uint64 expiresAt)',
])
const pub = createPublicClient({ chain, transport: http() })
const payerWallet = createWalletClient({ account: payer, chain, transport: http() })
const merchantWallet = createWalletClient({ account: merchant, chain, transport: http() })
const bal = (a: `0x${string}`) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
const fmt = (n: bigint) => formatUnits(n, 6)
const ok = (c: boolean, l: string) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`)
  if (!c) process.exitCode = 1
}
const wait = async (h: `0x${string}`) => {
  const r = await pub.waitForTransactionReceipt({ hash: h })
  if (r.status !== 'success') throw new Error(`reverted ${h}`)
  return r
}

const kit = new AppKit()
const adapter = createViemAdapterFromPrivateKey({ privateKey: keys.payer })
const route = { from: { adapter, chain: 'Base_Sepolia' as const }, to: { adapter, chain: 'Arc_Testnet' as const } }
const invoiceAmount = parseUnits('1', 6)

const est = await kit.estimateBridge({ ...route, amount: fmt(invoiceAmount) })
console.log('fees', JSON.stringify(est.fees))
let fee = 0n
for (const f of est.fees) if (f.token === 'USDC' && f.amount) fee += parseUnits(f.amount, 6)
const burnAmount = invoiceAmount + fee * 2n
console.log(`bridging ${fmt(burnAmount)} USDC (invoice 1 + fee ${fmt(fee)} x2)`)

const arcBefore = await bal(payer.address)
const result = await kit.bridge({ ...route, amount: fmt(burnAmount) })
for (const s of result.steps) console.log(`step ${s.name}: ${s.state} ${s.txHash ?? ''}`)
ok(result.state === 'success', `bridge state ${result.state}`)
const arcAfter = await bal(payer.address)
// Gas for the mint is paid in USDC from the same Arc balance, so the net rise is the mint amount minus that gas.
console.log(`Arc balance rose by ${fmt(arcAfter - arcBefore)} USDC (minted amount minus mint gas)`)

// Create an invoice and pay it with the bridged funds.
const created = await wait(await merchantWallet.writeContract({ address: vault, abi, functionName: 'createInvoice', args: [invoiceAmount, 'E2E bridge invoice', 0n] }))
const [ev] = parseEventLogs({ abi, eventName: 'InvoiceCreated', logs: created.logs })
const feeRecipient = await pub.readContract({ address: vault, abi, functionName: 'feeRecipient' })
const [m0, f0] = await Promise.all([bal(merchant.address), bal(feeRecipient)])
await wait(await payerWallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [vault, invoiceAmount] }))
const pay = await wait(await payerWallet.writeContract({ address: vault, abi, functionName: 'payInvoice', args: [ev.args.id] }))
const [m1, f1] = await Promise.all([bal(merchant.address), bal(feeRecipient)])
console.log(`PAYMENT TX ${pay.transactionHash}`)
ok(m1 - m0 === parseUnits('0.99', 6), `merchant +${fmt(m1 - m0)}`)
ok(f1 - f0 === parseUnits('0.01', 6), `fee recipient +${fmt(f1 - f0)}`)
