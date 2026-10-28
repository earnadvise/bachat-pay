/**
 * wagmi configuration — ConnectKit defaultConfig for full mobile wallet support
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected, walletConnect, coinbaseWallet, safe } from 'wagmi/connectors'
import { registerChain } from './tracing'

registerChain(arc.id, arc.rpcUrls.default.http[0])

// Free public WalletConnect project ID — enables Trust Wallet, Rainbow,
// MetaMask mobile, Uniswap, Zerion, 1inch, and 400+ more mobile wallets
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID as string | undefined ?? 'b56e18d47c72ab683b10814fe9495694'

export const config = createConfig({
  chains: [arc, mainnet],
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: 'BachatPay',
        description: 'USDC payments on Arc — like GPay but onchain',
        url: 'https://arc-studio-7630b92000bb479e8ada5b05.vercel.app',
        icons: ['https://arc-studio-7630b92000bb479e8ada5b05.vercel.app/icons/icon.svg'],
      },
    }),
    coinbaseWallet({
      appName: 'BachatPay',
      appLogoUrl: 'https://arc-studio-7630b92000bb479e8ada5b05.vercel.app/icons/icon.svg',
    }),
    safe(),
  ],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http('https://eth.llamarpc.com'),
  },
})
