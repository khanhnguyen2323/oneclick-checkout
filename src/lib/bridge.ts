import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { numberToHex, type Chain, type EIP1193Provider } from 'viem'
import { ARC, SOURCE } from '@/config/network'

export const appKit = new AppKit()

export type BridgeAdapter = Awaited<ReturnType<typeof createViemAdapterFromProvider>>
export type BridgeResult = Awaited<ReturnType<AppKit['bridge']>>

const supportedChains: readonly Chain[] = [ARC.chain, SOURCE.chain]

const isUnrecognizedChain = (error: unknown) => {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } }
  return e?.code === 4902 || e?.data?.originalError?.code === 4902 // nested on MetaMask mobile
}

/**
 * The adapter switches the wallet to the destination chain for the mint. A wallet that lacks
 * that chain rejects with 4902 after the burn, so add the chain and retry the switch.
 */
export function withAddChainFallback(provider: EIP1193Provider, chains: readonly Chain[]): EIP1193Provider {
  const send = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await send(args)
    } catch (error) {
      if (args.method !== 'wallet_switchEthereumChain' || !isUnrecognizedChain(error)) throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const chain = chains.find((c) => c.id === Number(chainId))
      if (!chain) throw error
      await send({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: numberToHex(chain.id),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      })
      return send(args)
    }
  }) as EIP1193Provider['request']

  // A Proxy, not a spread: wallet providers are class instances.
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request
      const value = Reflect.get(target, prop, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

export async function createAdapter(provider: unknown): Promise<BridgeAdapter> {
  return createViemAdapterFromProvider({
    provider: withAddChainFallback(provider as EIP1193Provider, supportedChains),
  })
}
