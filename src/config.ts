/**
 * wagmi configuration — ConnectKit defaultConfig for mobile wallet support
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'
import { registerChain } from './tracing'

registerChain(arc.id, arc.rpcUrls.default.http[0])

// WalletConnect project ID — get a free one at https://cloud.walletconnect.com
// Falls back gracefully if not set (injected MetaMask still works)
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID as string | undefined

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({ appName: 'BachatPay', appLogoUrl: 'https://bachat-pay.vercel.app/icon.png' }),
  ...(WC_PROJECT_ID
    ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true })]
    : []),
]

export const config = createConfig({
  chains: [arc, mainnet],
  connectors,
  transports: {
    [arc.id]: http(),
    [mainnet.id]: http(),
  },
})
