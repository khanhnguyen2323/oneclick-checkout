/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "testnet" (default) or "mainnet". The one value that switches networks. */
  readonly VITE_NETWORK?: string
  readonly VITE_INVOICE_VAULT_ADDRESS_TESTNET?: string
  readonly VITE_INVOICE_VAULT_ADDRESS_MAINNET?: string
  readonly VITE_INVOICE_VAULT_DEPLOY_BLOCK_TESTNET?: string
  readonly VITE_INVOICE_VAULT_DEPLOY_BLOCK_MAINNET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
