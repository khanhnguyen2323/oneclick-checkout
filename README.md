# OneClick Checkout

Get paid in USDC on Arc, from any chain. Merchants create invoices and share a pay link or QR code. Customers pay with USDC they already hold on Arc, or bridge it from Base in the same flow. Every payment goes through the InvoiceVault contract, which splits the platform fee, pays the merchant directly and stores an onchain receipt.

Built with [Arc Studio](https://studio.arc.io)

## What it does

- **Merchants** (`/merchant`): create invoices with an amount, memo and optional expiry, see totals (received, paid, pending), copy the pay link, show a QR code, and cancel unpaid invoices.
- **Customers** (`/pay/<id>`): pay with USDC on Arc (approve exactly the invoice amount, then pay), or pay from Base using Circle Bridge Kit (CCTP V2). The bridge shows each step and can be resumed if it fails.
- **Receipts** (`/receipt/<id>`): payer, time, fee, and links to the payment and bridge transactions.
- A TESTNET badge shows whenever the testnet profile is active.

## Architecture

- `contracts/InvoiceVault.sol`: Solidity contract (OpenZeppelin SafeERC20, ReentrancyGuard, Ownable2Step). It never holds USDC: the payer's funds go straight to the merchant and the fee recipient. Fees are fixed at deployment and capped at 2%.
- `contracts/test/InvoiceVault.t.sol`: Foundry tests (67 passing).
- `src/config/network.ts`: the single network config with `testnet` and `mainnet` profiles. Chain IDs, RPC and explorer URLs and USDC addresses come from the registry in `src/onchain-facts.ts`.
- `src/pages`, `src/components`, `src/hooks`: React + TypeScript UI, wagmi and viem for wallet and contract access, Circle App Kit (Bridge Kit) for cross-chain payments.
- `scripts/e2e-testnet.ts`, `scripts/e2e-bridge.ts`: testnet end-to-end checks using throwaway keys.

USDC amounts are always handled in the 6-decimal ERC-20 view. Native gas on Arc is USDC too, but it is never mixed into invoice amounts.

## Contract addresses

| Network | Chain ID | InvoiceVault | USDC |
| --- | --- | --- | --- |
| Arc Testnet | 5042002 | `0x85eddb6aba2b1fe18e8a680f5397487de48d85b5` | `0x3600000000000000000000000000000000000000` |
| Arc mainnet | 5042 | not deployed | `0x3600000000000000000000000000000000000000` |

Testnet deployment: fee 1% (100 bps), fee recipient `0xAc85EcF981d289fFbbcF6eaBF2a71dA3757b6917`.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run dev              # app on http://localhost:5173
bun run build            # production build
bun run check            # lint + typecheck
bun run contracts:build  # forge build
bun run contracts:test   # forge test
bun scripts/e2e-testnet.ts address   # prints a throwaway payer address to fund
bun scripts/e2e-testnet.ts run       # create + pay a 1 USDC invoice on Arc Testnet
```

### Environment variables

- `VITE_NETWORK`: `testnet` (default) or `mainnet`. The only value you change to switch networks.
- `VITE_INVOICE_VAULT_ADDRESS_TESTNET`: deployed vault on Arc Testnet.
- `VITE_INVOICE_VAULT_ADDRESS_MAINNET`: deployed vault on Arc mainnet.
- `VITE_INVOICE_VAULT_DEPLOY_BLOCK_TESTNET`, `VITE_INVOICE_VAULT_DEPLOY_BLOCK_MAINNET`: optional deployment blocks.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio for the e2e scripts; optional elsewhere.

Create a `.env` with these values. It is git-ignored.

## Switching to mainnet

Review and test on testnet first, and get an independent audit before using real funds.

1. Deploy `InvoiceVault` from your own wallet with constructor arguments `(usdc, feeRecipient, feeBps)`. Use the Arc USDC address from the table above, a fee recipient you control and `100` for 1%. The deployer becomes the owner.
2. Set `VITE_INVOICE_VAULT_ADDRESS_MAINNET` to the new address (optionally the deploy block too).
3. Set `VITE_NETWORK=mainnet` and restart. The app now uses Arc mainnet and Base for bridging, and the TESTNET badge disappears.

No code changes are needed.

## How Arc Studio was used

Arc Studio wrote the contract, reviewed it, wrote and ran the tests, deployed to Arc Testnet, built the app and ran the testnet end-to-end checks from this conversation.
