/**
 * BachatPay — NanoPayGateway contract config.
 * Generated from the deployed artifact. Do not edit addresses by hand.
 */
import artifact from '../contracts/out/NanoPayGateway.sol/NanoPayGateway.json'

export const NANOPAY_TESTNET = {
  address: '0x442ef83fcfd7ae6c5cd3d832cee116abe83bc44f' as const,
  abi: artifact.abi,
  chainId: 5042002, // Arc Testnet
}

// Mainnet address will be set after deploy — placeholder here so TypeScript is happy.
// Update after: bun run deploy:mainnet
export const NANOPAY_MAINNET = {
  address: '' as `0x${string}`,
  abi: artifact.abi,
  chainId: 5042, // Arc mainnet
}
