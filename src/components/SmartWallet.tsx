/**
 * BachatPay — Circle Modular Wallets (Passkey Smart Wallet)
 * Lets users register/login with a passkey and get a gasless smart account.
 */
import { useState, useEffect } from 'react'
import { createPublicClient, parseUnits, type Hex } from 'viem'
import { arcTestnet } from 'viem/chains'
import {
  type P256Credential,
  createBundlerClient,
  toWebAuthnAccount,
} from 'viem/account-abstraction'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  encodeTransfer,
  ContractAddress,
} from '@circle-fin/modular-wallets-core'
import { Fingerprint, Loader2, CheckCircle2, LogIn, UserPlus, Zap } from 'lucide-react'
import { toast } from 'sonner'

const clientKey = import.meta.env.VITE_CLIENT_KEY as string | undefined
const clientUrl = import.meta.env.VITE_CLIENT_URL as string | undefined

const USDC_DECIMALS = 6

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.10)',
    borderRadius: '1.5rem',
    padding: '1.5rem',
  } as React.CSSProperties,
}

type WalletState = 'idle' | 'loading' | 'connected'

interface SmartWalletProps {
  /** Called when user successfully connects a smart wallet */
  onConnected?: (address: string) => void
}

export function SmartWallet({ onConnected }: SmartWalletProps) {
  const [state, setState] = useState<WalletState>('idle')
  const [address, setAddress] = useState<string | null>(null)
  const [username, setUsername] = useState('')

  const isConfigured = !!(clientKey && clientUrl && clientKey.startsWith('TEST_CLIENT_KEY'))

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('bachat_credential')
    if (!saved || !isConfigured) return
    const credential = JSON.parse(saved) as P256Credential
    void restoreSession(credential)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured])

  const makeTransports = () => {
    if (!clientKey || !clientUrl) throw new Error('Client key not configured')
    const passkeyTransport = toPasskeyTransport(clientUrl, clientKey)
    const modularTransport = toModularTransport(`${clientUrl}/arcTestnet`, clientKey)
    return { passkeyTransport, modularTransport }
  }

  const restoreSession = async (credential: P256Credential) => {
    try {
      setState('loading')
      const { modularTransport } = makeTransports()
      const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
      const account = await toCircleSmartAccount({
        client: publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      setAddress(account.address)
      setState('connected')
      onConnected?.(account.address)
    } catch {
      setState('idle')
      localStorage.removeItem('bachat_credential')
    }
  }

  const handleRegister = async () => {
    if (!username.trim()) { toast.error('Enter a username first'); return }
    try {
      setState('loading')
      const { passkeyTransport, modularTransport } = makeTransports()
      const credential = await toWebAuthnCredential({
        transport: passkeyTransport,
        mode: WebAuthnMode.Register,
        username: username.trim(),
      })
      localStorage.setItem('bachat_credential', JSON.stringify(credential))
      const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
      const account = await toCircleSmartAccount({
        client: publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      setAddress(account.address)
      setState('connected')
      onConnected?.(account.address)
      toast.success('Smart wallet created!')
    } catch (e: unknown) {
      setState('idle')
      const msg = e instanceof Error ? e.message : 'Passkey registration failed'
      toast.error(msg.includes('NotAllowed') ? 'Passkey cancelled — try again' : msg)
    }
  }

  const handleLogin = async () => {
    try {
      setState('loading')
      const { passkeyTransport, modularTransport } = makeTransports()
      const credential = await toWebAuthnCredential({
        transport: passkeyTransport,
        mode: WebAuthnMode.Login,
      })
      localStorage.setItem('bachat_credential', JSON.stringify(credential))
      const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
      const account = await toCircleSmartAccount({
        client: publicClient,
        owner: toWebAuthnAccount({ credential }),
      })
      setAddress(account.address)
      setState('connected')
      onConnected?.(account.address)
      toast.success('Smart wallet connected!')
    } catch (e: unknown) {
      setState('idle')
      const msg = e instanceof Error ? e.message : 'Passkey login failed'
      toast.error(msg.includes('NotAllowed') ? 'Passkey cancelled — try again' : msg)
    }
  }

  const handleDisconnect = () => {
    localStorage.removeItem('bachat_credential')
    setAddress(null)
    setState('idle')
  }

  // Demo: gasless USDC send using paymaster
  const handleGaslessPay = async (recipient: Hex, amount: string) => {
    const saved = localStorage.getItem('bachat_credential')
    if (!saved) { toast.error('Connect smart wallet first'); return }
    const credential = JSON.parse(saved) as P256Credential
    const { modularTransport } = makeTransports()
    const publicClient = createPublicClient({ chain: arcTestnet, transport: modularTransport })
    const account = await toCircleSmartAccount({
      client: publicClient,
      owner: toWebAuthnAccount({ credential }),
    })
    const bundlerClient = createBundlerClient({ chain: arcTestnet, transport: modularTransport })
    const callData = encodeTransfer(
      recipient,
      ContractAddress.ArcTestnet_USDC,
      parseUnits(amount, USDC_DECIMALS),
    )
    const hash = await bundlerClient.sendUserOperation({ account, calls: [callData], paymaster: true })
    const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash })
    return receipt.transactionHash
  }

  // Expose for external use
  ;(window as unknown as Record<string, unknown>)._bachatGaslessPay = handleGaslessPay

  if (!isConfigured) {
    return (
      <div style={glass.card}>
        <div className="flex items-center gap-2 mb-3">
          <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <Fingerprint className="size-4" style={{ color: 'var(--muted)' }} />
          </div>
          <span className="display font-600 text-sm" style={{ color: 'var(--ink)', fontWeight: 600 }}>Smart Wallet (Passkey)</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Paste your <code className="mono">VITE_CLIENT_KEY</code> in <code className="mono">.env</code> to enable passkey login — no seed phrase needed.
        </p>
      </div>
    )
  }

  if (state === 'connected' && address) {
    return (
      <div style={glass.card}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(26,128,71,0.10)' }}>
              <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
            </div>
            <span className="display font-600 text-sm" style={{ color: 'var(--ink)', fontWeight: 600 }}>Smart Wallet</span>
          </div>
          <button onClick={handleDisconnect} className="text-xs px-3 py-1 rounded-full" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
            Disconnect
          </button>
        </div>
        <p className="mono text-xs truncate mb-2" style={{ color: 'var(--ink-2)' }}>{address}</p>
        <div className="flex items-center gap-1.5">
          <Zap className="size-3" style={{ color: 'var(--success)' }} />
          <span className="text-xs" style={{ color: 'var(--success)' }}>Gas-free transactions via Circle Gas Station</span>
        </div>
      </div>
    )
  }

  return (
    <div style={glass.card}>
      <div className="flex items-center gap-2 mb-4">
        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(18,45,69,0.08)' }}>
          <Fingerprint className="size-4" style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <p className="display font-600 text-sm" style={{ color: 'var(--ink)', fontWeight: 600 }}>Smart Wallet</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Passkey login — no seed phrase, gasless txs</p>
        </div>
      </div>

      <input
        className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none"
        style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
        placeholder="Username (for new wallet)"
        value={username}
        onChange={e => { setUsername(e.target.value) }}
        disabled={state === 'loading'}
      />

      <div className="flex gap-2">
        <button
          onClick={() => { void handleRegister() }}
          disabled={state === 'loading'}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-600 transition-all disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff', fontWeight: 600 }}
        >
          {state === 'loading' ? <Loader2 className="size-3 animate-spin" /> : <UserPlus className="size-3" />}
          Register
        </button>
        <button
          onClick={() => { void handleLogin() }}
          disabled={state === 'loading'}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-600 transition-all disabled:opacity-40"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)', fontWeight: 600 }}
        >
          {state === 'loading' ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
          Login
        </button>
      </div>
    </div>
  )
}
