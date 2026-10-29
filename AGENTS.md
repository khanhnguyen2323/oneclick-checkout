# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

---

## OneClick Checkout (project notes)

- App: USDC invoice payments on Arc. Merchants share `/pay/<id>` links; customers pay on Arc or bridge from Base (Circle App Kit, CCTP V2) then pay.
- Contract: `contracts/InvoiceVault.sol`, constructor `(usdc, feeRecipient, feeBps)`, owner = deployer, Ownable2Step, renounce disabled, memo max 140 bytes, feeBps fixed (max 200).
- Arc Testnet deployment: `0x85eddb6aba2b1fe18e8a680f5397487de48d85b5` (deploy block 69658145, feeBps 100, fee recipient `0xAc85EcF981d289fFbbcF6eaBF2a71dA3757b6917`, owner is the shared platform deployer). The earlier 4-arg version at `0x1d6744e4...6144` is superseded.
- Network switch: `VITE_NETWORK` (`testnet` | `mainnet`) in `.env`; per-network vault in `VITE_INVOICE_VAULT_ADDRESS_TESTNET` / `_MAINNET`. All profile data lives in `src/config/network.ts`. Restart the dev server after changing `.env`.
- Tests: `contracts/test/InvoiceVault.t.sol`, 67 passing. E2E on testnet: `scripts/e2e-testnet.ts`, `scripts/e2e-bridge.ts`.
- Arc gas is paid in USDC from the same balance, so the Base bridge flow adds a gas allowance on top of the invoice amount and CCTP fee.
- Mainnet: not deployed by Arc Studio. The user deploys from their own wallet after independent review.
