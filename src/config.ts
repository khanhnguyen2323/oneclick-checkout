/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet, base, baseSepolia } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { requireChain } from './onchain-facts'

const rpc = (id: number) => requireChain(id).rpcUrls[0]

// Pre-register chain RPC URLs so trace events show correct chain names immediately
for (const chain of [arcTestnet, arc, baseSepolia, base]) registerChain(chain.id, rpc(chain.id))

// Both profiles are always available; VITE_NETWORK (src/config/network.ts) picks the active one.
export const config = createConfig({
  chains: [arcTestnet, arc, baseSepolia, base, mainnet], // Ethereum mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(rpc(arcTestnet.id)),
    [arc.id]: http(rpc(arc.id)),
    [baseSepolia.id]: http(rpc(baseSepolia.id)),
    [base.id]: http(rpc(base.id)),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
