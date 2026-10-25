# BachatPay — Trustless Pay-Per-Call API Gateway on Arc

A trustless onchain API gateway where any wallet (or AI agent) pays a small USDC amount to register a request onchain. Services listening to `CallPaid` events can fulfil those requests automatically. Demonstrates software-to-software micropayments on Arc, where USDC is the native gas token.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS
- **Web3**: wagmi v2, viem v2, ConnectKit
- **Smart contract**: Solidity 0.8.28, Foundry, deployed to Arc Testnet and Arc mainnet
- **Chain**: Arc Testnet (Chain ID 5042002) / Arc mainnet (Chain ID 5042)
- **Token**: USDC (6 decimals ERC-20, native gas on Arc)

## Development

### Prerequisites

- [Bun](https://bun.sh) v1+
- [Foundry](https://getfoundry.sh) (for contract work)

### Install

```bash
bun install
```

### Environment variables

| Variable | Purpose | Required outside Arc Studio |
|---|---|---|
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL | Optional (falls back to public RPC) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy auth token | Optional |
| `RPC_PROXY_CHAINS` | Comma-separated proxy chain keys | Optional |

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Contract build & test

```bash
bun run contracts:build   # forge build
bun run contracts:test    # forge test
```

## What it does

1. A user connects their wallet and types a request description (e.g. "Get current BTC/USD price").
2. They approve $0.10 USDC allowance to the contract, then pay.
3. The `NanoPayGateway` contract records the call onchain and emits a `CallPaid(caller, callId, amount, requestData)` event.
4. Any off-chain service or AI agent watching for that event can fulfil the request and respond.

This makes every API call verifiable, tamper-proof, and payable without an API key or traditional billing relationship.
