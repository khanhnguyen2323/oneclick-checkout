/**
 * Single source of truth for network settings.
 *
 * Switch networks by changing ONE value: VITE_NETWORK=testnet | mainnet.
 * Chain IDs, RPC and explorer URLs and USDC addresses come from the generated
 * `@/onchain-facts` registry. Only the InvoiceVault address (and its deploy
 * block) is yours to provide, per network, in `.env`:
 *   VITE_INVOICE_VAULT_ADDRESS_TESTNET / VITE_INVOICE_VAULT_ADDRESS_MAINNET
 *   VITE_INVOICE_VAULT_DEPLOY_BLOCK_TESTNET / VITE_INVOICE_VAULT_DEPLOY_BLOCK_MAINNET (optional)
 */

import type { Address, Chain } from 'viem'
import { arc, arcTestnet, base, baseSepolia } from 'viem/chains'
import type { BridgeParams } from '@circle-fin/app-kit'
import { getUsdc, requireChain } from '@/onchain-facts'

export type NetworkName = 'testnet' | 'mainnet'
export type BridgeChainName = BridgeParams['from']['chain']

export interface ChainProfile {
  chain: Chain
  chainId: number
  name: string
  rpcUrl: string
  explorerUrl: string
  usdc: Address
  usdcDecimals: number
  /** Chain name as Circle Bridge Kit (CCTP V2) expects it. */
  bridgeKitName: BridgeChainName
}

export interface NetworkProfile {
  name: NetworkName
  isTestnet: boolean
  /** Where invoices live and are paid. */
  arc: ChainProfile & { vault: Address | undefined; vaultDeployBlock: bigint | undefined }
  /** Chain customers can bridge USDC from. */
  source: ChainProfile
}

function chainProfile(chain: Chain, bridgeKitName: BridgeChainName): ChainProfile {
  const facts = requireChain(chain.id)
  const usdc = getUsdc(chain.id)
  if (!usdc) throw new Error(`USDC is not registered for chain ${chain.id}`)
  return {
    chain,
    chainId: chain.id,
    name: facts.name,
    rpcUrl: facts.rpcUrls[0],
    explorerUrl: facts.explorerBase,
    usdc: usdc.address as Address,
    usdcDecimals: usdc.decimals,
    bridgeKitName,
  }
}

function parseAddress(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : undefined
}

function parseBlock(value: string | undefined): bigint | undefined {
  return value && /^\d+$/.test(value) ? BigInt(value) : undefined
}

const env = import.meta.env

const PROFILES: Record<NetworkName, NetworkProfile> = {
  testnet: {
    name: 'testnet',
    isTestnet: true,
    arc: {
      ...chainProfile(arcTestnet, 'Arc_Testnet'),
      vault: parseAddress(env.VITE_INVOICE_VAULT_ADDRESS_TESTNET),
      vaultDeployBlock: parseBlock(env.VITE_INVOICE_VAULT_DEPLOY_BLOCK_TESTNET),
    },
    source: chainProfile(baseSepolia, 'Base_Sepolia'),
  },
  mainnet: {
    name: 'mainnet',
    isTestnet: false,
    arc: {
      ...chainProfile(arc, 'Arc'),
      vault: parseAddress(env.VITE_INVOICE_VAULT_ADDRESS_MAINNET),
      vaultDeployBlock: parseBlock(env.VITE_INVOICE_VAULT_DEPLOY_BLOCK_MAINNET),
    },
    source: chainProfile(base, 'Base'),
  },
}

const requested = (env.VITE_NETWORK ?? 'testnet')
if (requested !== 'testnet' && requested !== 'mainnet') {
  throw new Error(`VITE_NETWORK must be "testnet" or "mainnet", got "${requested}"`)
}

export const NETWORK: NetworkProfile = PROFILES[requested]
export const ARC = NETWORK.arc
export const SOURCE = NETWORK.source

export function explorerTx(chain: ChainProfile, hash: string): string {
  return `${chain.explorerUrl}/tx/${hash}`
}

export function explorerAddress(chain: ChainProfile, address: string): string {
  return `${chain.explorerUrl}/address/${address}`
}
