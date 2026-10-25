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

export const NANOPAY_MAINNET = {
  address: '0xa5d6C4a683d18a0f38CB68eC5345B95a17DEf306' as const,
  abi: artifact.abi,
  chainId: 5042, // Arc mainnet
}
