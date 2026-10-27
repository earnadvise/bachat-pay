# BachatPay — Trustless Pay-Per-Call API Gateway

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app.

---

## What This App Does

BachatPay is a USDC payments app on Arc — like GPay but onchain. It includes a pay/receive flow, goal-based savings vaults, and onchain ROSCA group savings (chit funds).

## Arc Mainnet Contracts
| Contract | Address |
|---|---|
| NanoPayGateway | 0xa5d6C4a683d18a0f38CB68eC5345B95a17DEf306 |
| BachatVault | 0x268c18C0367b1Bafc81C53f3C3EBA81C321ec130 |
| ChitFund | 0x18129a7d1F97e4BDda369AF67925e63B01536bF9 |

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
