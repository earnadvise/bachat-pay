/**
 * BachatPay — USDC Shop Payments on Arc
 * Pay shopkeepers with USDC via QR code. Bridge from any chain automatically.
 * Built with Arc Studio — https://studio.arc.io
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { ConnectKitButton } from 'connectkit'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useConnectorClient,
  useChainId,
} from 'wagmi'
import { erc20Abi, parseUnits, formatUnits, isAddress } from 'viem'
import { arc, base, arbitrum, optimism, polygon, mainnet } from 'viem/chains'
import { toast } from 'sonner'
import {
  QrCode, Send, ArrowLeftRight, Clock, ExternalLink,
  CheckCircle2, Loader2, Copy, ShoppingBag, Zap, ChevronRight,
  ArrowDown,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider, Chain } from 'viem'
import { buildShareLink } from './lib/share'

// ── Arc Mainnet constants ──────────────────────────────────────────────────────
const ARC_CHAIN_ID = 5042
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const EXPLORER = 'https://explorer.arc.io'

// Circle App Kit for bridging
const appKit = new AppKit()

// Supported source chains for bridge
const BRIDGE_CHAINS: Array<{ chain: Chain; kitName: string; label: string }> = [
  { chain: base, kitName: 'Base', label: 'Base' },
  { chain: arbitrum, kitName: 'Arbitrum', label: 'Arbitrum' },
  { chain: optimism, kitName: 'Optimism', label: 'Optimism' },
  { chain: polygon, kitName: 'Polygon', label: 'Polygon' },
  { chain: mainnet, kitName: 'Ethereum', label: 'Ethereum' },
]

// Glass tokens
const glass = {
  card: {
    background: 'rgba(255,255,255,0.64)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.68)',
    boxShadow: '0 8px 32px rgba(18,45,69,0.08), inset 0 1px 0 rgba(255,255,255,0.55)',
    borderRadius: '20px',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.46)',
    border: '1px solid rgba(255,255,255,0.56)',
    borderRadius: '12px',
  } as React.CSSProperties,
}

const spectral = 'linear-gradient(90deg, #5fbeff, #af8ff4, #f05c6b, #ffcd83, #7ef1b3)'

// withAddChainFallback — allows adding unknown destination chains to wallet
const isUnrecognizedChain = (error: unknown) => {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } }
  return e?.code === 4902 || e?.data?.originalError?.code === 4902
}

function withAddChainFallback(provider: EIP1193Provider, chains: readonly Chain[]): EIP1193Provider {
  const send = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await send(args)
    } catch (error) {
      if (args.method !== 'wallet_switchEthereumChain' || !isUnrecognizedChain(error)) throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const chain = chains.find((c) => c.id === Number(chainId))
      if (!chain) throw error
      await send({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: `0x${chain.id.toString(16)}`,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
        }],
      })
      return send(args)
    }
  }) as EIP1193Provider['request']

  return new Proxy(provider, {
    get(target, prop) {
      if (prop === 'request') return request
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// Payment history entry
interface HistoryEntry {
  hash: string
  to: string
  amount: string
  note: string
  ts: number
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { data: connectorClient } = useConnectorClient()

  const [tab, setTab] = useState<'pay' | 'receive' | 'bridge' | 'history'>(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('to') ? 'pay' : 'pay'
  })

  // ── USDC balance on Arc ────────────────────────────────────────────────────
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  })

  const balanceDisplay = usdcBalance != null
    ? Number(formatUnits(usdcBalance as bigint, USDC_DECIMALS)).toFixed(2)
    : '—'

  // ── Pay tab state ──────────────────────────────────────────────────────────
  const [payTo, setPayTo] = useState(() => new URLSearchParams(window.location.search).get('to') ?? '')
  const [payAmount, setPayAmount] = useState(() => new URLSearchParams(window.location.search).get('amount') ?? '')
  const [payNote, setPayNote] = useState('')
  const [payStep, setPayStep] = useState<'idle' | 'approving' | 'sending' | 'done'>('idle')
  const [payHash, setPayHash] = useState<`0x${string}` | undefined>()
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('bachatpay-history') ?? '[]') as HistoryEntry[] }
    catch { return [] }
  })

  const saveHistory = useCallback((entry: HistoryEntry) => {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 50)
      localStorage.setItem('bachatpay-history', JSON.stringify(next))
      return next
    })
  }, [])

  // Transfer USDC
  const { writeContractAsync: transferUsdc } = useWriteContract()
  const { isSuccess: transferSuccess } = useWaitForTransactionReceipt({ hash: payHash, chainId: ARC_CHAIN_ID })

  // Finalize after transfer confirmed onchain
  useEffect(() => {
    if (!transferSuccess || payStep !== 'sending' || !payHash) return
    setPayStep('done')
    saveHistory({ hash: payHash, to: payTo, amount: payAmount, note: payNote, ts: Date.now() })
    void refetchBalance()
    toast.success('Payment sent!')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferSuccess]) // intentionally narrow — fires exactly once when tx confirms

  const handlePay = useCallback(async () => {
    if (!address || !isAddress(payTo) || !payAmount) return
    if (chainId !== ARC_CHAIN_ID) {
      try { await switchChainAsync({ chainId: ARC_CHAIN_ID }) }
      catch { toast.error('Please switch to Arc Mainnet'); return }
    }
    try {
      setPayStep('approving')
      const amountRaw = parseUnits(payAmount, USDC_DECIMALS)
      // For direct transfer we don't need approve, go straight to transfer
      setPayStep('sending')
      const hash = await transferUsdc({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [payTo as `0x${string}`, amountRaw],
        chainId: ARC_CHAIN_ID,
      })
      setPayHash(hash)
    } catch (e) {
      toast.error((e as Error).message ?? 'Payment failed')
      setPayStep('idle')
    }
  }, [address, payTo, payAmount, chainId, switchChainAsync, transferUsdc])

  const resetPay = () => {
    setPayStep('idle')
    setPayHash(undefined)
    setPayTo('')
    setPayAmount('')
    setPayNote('')
  }

  // ── Receive tab — QR code ──────────────────────────────────────────────────
  const [receiveAmount, setReceiveAmount] = useState('')
  const [shareLink, setShareLink] = useState('')
  const qrValue = shareLink
    ? `${shareLink}?to=${address ?? ''}&amount=${receiveAmount}`
    : `bachatpay:${address ?? ''}?amount=${receiveAmount}`

  useEffect(() => {
    void buildShareLink('/').then(base => setShareLink(base))
  }, [])

  const copyQR = useCallback(async () => {
    const link = `${shareLink}?to=${address ?? ''}&amount=${receiveAmount}`
    await navigator.clipboard.writeText(link)
    toast.success('Payment link copied!')
  }, [shareLink, address, receiveAmount])

  // URL params handled in useState initializers above (payTo, payAmount)

  // ── Bridge tab ─────────────────────────────────────────────────────────────
  const [bridgeFrom, setBridgeFrom] = useState(BRIDGE_CHAINS[0])
  const [bridgeAmount, setBridgeAmount] = useState('')
  const [bridgeStep, setBridgeStep] = useState<'idle' | 'bridging' | 'done'>('idle')
  const [bridgeSteps, setBridgeSteps] = useState<Array<{ name: string; state: string }>>([])
  const bridgeResultRef = useRef<unknown>(null)

  const handleBridge = useCallback(async () => {
    if (!connectorClient || !bridgeAmount || !address) return
    try {
      setBridgeStep('bridging')
      setBridgeSteps([])

      // Switch wallet to source chain
      if (chainId !== bridgeFrom.chain.id) {
        await switchChainAsync({ chainId: bridgeFrom.chain.id })
      }

      // Get raw EIP-1193 provider from connector transport
      const rawProvider = (
        connectorClient.transport as unknown as { provider?: EIP1193Provider }
      ).provider
      if (!rawProvider) throw new Error('Could not get wallet provider')

      const adapter = await createViemAdapterFromProvider({
        provider: withAddChainFallback(rawProvider, [arc, ...BRIDGE_CHAINS.map(b => b.chain)]),
      })

      const result = await appKit.bridge({
        token: 'USDC',
        from: { adapter, chain: bridgeFrom.kitName as Parameters<typeof appKit.bridge>[0]['from']['chain'] },
        to: { adapter, chain: 'Arc' as Parameters<typeof appKit.bridge>[0]['to']['chain'] },
        amount: bridgeAmount,
      })

      bridgeResultRef.current = result
      const steps = (result as { steps?: Array<{ name: string; state: string }> }).steps
      if (steps) setBridgeSteps(steps)
      setBridgeStep('done')
      void refetchBalance()
      toast.success(`Bridged ${bridgeAmount} USDC to Arc!`)
    } catch (e) {
      toast.error((e as Error).message ?? 'Bridge failed')
      setBridgeStep('idle')
    }
  }, [connectorClient, bridgeAmount, address, chainId, bridgeFrom, switchChainAsync, refetchBalance])

  // ── Tabs config ────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'pay' as const, label: 'Pay', icon: <Send className="size-4" /> },
    { id: 'receive' as const, label: 'Receive', icon: <QrCode className="size-4" /> },
    { id: 'bridge' as const, label: 'Bridge', icon: <ArrowLeftRight className="size-4" /> },
    { id: 'history' as const, label: 'History', icon: <Clock className="size-4" /> },
  ]

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'linear-gradient(180deg, #f9f9fc 0%, #fffcf7 52%, #fbf7f2 100%)' }}>
      {/* Background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div style={{ position: 'absolute', top: '8%', left: '5%', width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(133,177,237,0.22) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', bottom: '8%', right: '8%', width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,205,131,0.20) 0%, transparent 70%)', filter: 'blur(58px)' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-4 pb-10 pt-6">
        {/* Header */}
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: spectral }}>
              <ShoppingBag className="size-5 text-white" />
            </div>
            <div>
              <span className="display block text-base font-bold" style={{ color: '#0f1e2e', letterSpacing: '-0.02em' }}>BachatPay</span>
              <span className="block text-xs" style={{ color: '#6b7a8d' }}>USDC payments on Arc</span>
            </div>
          </div>
          <ConnectKitButton />
        </header>

        {/* Balance hero card */}
        {isConnected && (
          <div className="mb-4 p-5" style={glass.card}>
            <div style={{ height: 3, borderRadius: 2, background: spectral, marginBottom: 16, marginLeft: -20, marginRight: -20, marginTop: -20, borderTopLeftRadius: 20, borderTopRightRadius: 20 }} />
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#6b7a8d' }}>USDC Balance · Arc Mainnet</p>
            <div className="flex items-end gap-2">
              <span className="display text-4xl font-bold tabular-nums" style={{ color: '#0f1e2e', letterSpacing: '-0.03em' }}>{balanceDisplay}</span>
              <div className="mb-1 flex items-center gap-1">
                <TokenUSDC size={20} />
                <span className="text-sm font-semibold" style={{ color: '#6b7a8d' }}>USDC</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="mb-4 flex rounded-2xl p-1 gap-1" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.7)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all"
              style={tab === t.id
                ? { background: 'white', color: '#0f1e2e', boxShadow: '0 2px 8px rgba(15,30,46,0.10)' }
                : { color: '#6b7a8d' }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── PAY TAB ───────────────────────────────────────────────────────── */}
        {tab === 'pay' && (
          <div style={glass.card} className="p-5">
            {payStep === 'done' && payHash ? (
              <div className="flex flex-col items-center py-4 gap-3 text-center">
                <CheckCircle2 className="size-12" style={{ color: '#22c55e' }} />
                <div>
                  <p className="display text-lg font-bold" style={{ color: '#0f1e2e' }}>Payment Sent!</p>
                  <p className="text-sm mt-1" style={{ color: '#6b7a8d' }}>{payAmount} USDC to {payTo.slice(0, 6)}...{payTo.slice(-4)}</p>
                </div>
                <a
                  href={`${EXPLORER}/tx/${payHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: '#3b82f6' }}
                >
                  View on Explorer <ExternalLink className="size-3" />
                </a>
                <button
                  onClick={resetPay}
                  className="mt-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white"
                  style={{ background: '#0f1e2e' }}
                >
                  New Payment
                </button>
              </div>
            ) : (
              <>
                <h2 className="display text-base font-bold mb-4" style={{ color: '#0f1e2e' }}>Send USDC</h2>

                {/* Recipient */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>To</label>
                  <input
                    type="text"
                    placeholder="0x... wallet address"
                    value={payTo}
                    onChange={e => setPayTo(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none transition-all"
                    style={{ ...glass.inner, color: '#0f1e2e' }}
                  />
                </div>

                {/* Amount */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>Amount (USDC)</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      className="w-full rounded-xl px-4 py-3 text-xl font-bold tabular-nums outline-none transition-all pr-16"
                      style={{ ...glass.inner, color: '#0f1e2e' }}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <TokenUSDC size={16} />
                      <span className="text-xs font-semibold" style={{ color: '#6b7a8d' }}>USDC</span>
                    </div>
                  </div>
                  {/* Quick amount chips */}
                  <div className="flex gap-2 mt-2">
                    {['1', '5', '10', '50'].map(v => (
                      <button
                        key={v}
                        onClick={() => setPayAmount(v)}
                        className="rounded-lg px-3 py-1 text-xs font-semibold transition-all"
                        style={{ background: 'rgba(255,255,255,0.7)', color: '#0f1e2e', border: '1px solid rgba(255,255,255,0.8)' }}
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Note */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>Note (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Groceries, Coffee..."
                    value={payNote}
                    onChange={e => setPayNote(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ ...glass.inner, color: '#0f1e2e' }}
                  />
                </div>

                {!isConnected ? (
                  <div className="flex justify-center">
                    <ConnectKitButton />
                  </div>
                ) : (
                  <button
                    onClick={() => void handlePay()}
                    disabled={!payTo || !payAmount || payStep !== 'idle'}
                    className="w-full rounded-xl py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                    style={{ background: '#0f1e2e' }}
                  >
                    {payStep === 'sending' ? (
                      <><Loader2 className="size-4 animate-spin" /> Sending...</>
                    ) : (
                      <><Send className="size-4" /> Pay {payAmount ? `$${payAmount}` : ''} USDC</>
                    )}
                  </button>
                )}

                {chainId !== ARC_CHAIN_ID && isConnected && (
                  <p className="text-center text-xs mt-2" style={{ color: '#f59e0b' }}>
                    Switch to Arc Mainnet to pay
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── RECEIVE TAB ───────────────────────────────────────────────────── */}
        {tab === 'receive' && (
          <div style={glass.card} className="p-5">
            <h2 className="display text-base font-bold mb-4" style={{ color: '#0f1e2e' }}>Receive USDC</h2>

            {!isConnected ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <QrCode className="size-12" style={{ color: '#d1d5db' }} />
                <p className="text-sm" style={{ color: '#6b7a8d' }}>Connect your wallet to generate a QR code</p>
                <ConnectKitButton />
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>Request Amount (optional)</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={receiveAmount}
                      onChange={e => setReceiveAmount(e.target.value)}
                      className="w-full rounded-xl px-4 py-3 text-xl font-bold tabular-nums outline-none pr-16"
                      style={{ ...glass.inner, color: '#0f1e2e' }}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <TokenUSDC size={16} />
                      <span className="text-xs font-semibold" style={{ color: '#6b7a8d' }}>USDC</span>
                    </div>
                  </div>
                </div>

                {/* QR code */}
                <div className="flex flex-col items-center gap-4">
                  <div className="p-4 rounded-2xl" style={{ background: 'white', boxShadow: '0 4px 24px rgba(15,30,46,0.08)' }}>
                    <QRCodeSVG
                      value={qrValue}
                      size={200}
                      level="M"
                      includeMargin={false}
                    />
                  </div>

                  <div className="w-full rounded-xl px-4 py-3 flex items-center justify-between gap-2" style={glass.inner}>
                    <span className="text-xs font-mono truncate" style={{ color: '#6b7a8d' }}>
                      {address?.slice(0, 10)}...{address?.slice(-6)}
                    </span>
                    <button
                      onClick={() => void copyQR()}
                      className="flex items-center gap-1 text-xs font-semibold shrink-0"
                      style={{ color: '#3b82f6' }}
                    >
                      <Copy className="size-3" /> Copy Link
                    </button>
                  </div>

                  <p className="text-xs text-center" style={{ color: '#6b7a8d' }}>
                    Show this QR to anyone. They scan it and pay you USDC on Arc instantly.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── BRIDGE TAB ────────────────────────────────────────────────────── */}
        {tab === 'bridge' && (
          <div style={glass.card} className="p-5">
            <h2 className="display text-base font-bold mb-1" style={{ color: '#0f1e2e' }}>Bridge to Arc</h2>
            <p className="text-sm mb-4" style={{ color: '#6b7a8d' }}>Bring USDC from any chain to Arc automatically</p>

            {bridgeStep === 'done' ? (
              <div className="flex flex-col items-center py-4 gap-3 text-center">
                <CheckCircle2 className="size-12" style={{ color: '#22c55e' }} />
                <p className="display text-lg font-bold" style={{ color: '#0f1e2e' }}>Bridged Successfully!</p>
                <p className="text-sm" style={{ color: '#6b7a8d' }}>{bridgeAmount} USDC is now on Arc Mainnet</p>
                <button
                  onClick={() => { setBridgeStep('idle'); setBridgeAmount(''); setBridgeSteps([]) }}
                  className="mt-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white"
                  style={{ background: '#0f1e2e' }}
                >
                  Bridge More
                </button>
              </div>
            ) : (
              <>
                {/* Source chain selector */}
                <div className="mb-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>From</label>
                  <div className="grid grid-cols-3 gap-2">
                    {BRIDGE_CHAINS.map(b => (
                      <button
                        key={b.kitName}
                        onClick={() => setBridgeFrom(b)}
                        className="rounded-xl py-2 text-xs font-semibold transition-all"
                        style={bridgeFrom.kitName === b.kitName
                          ? { background: '#0f1e2e', color: 'white' }
                          : { ...glass.inner, color: '#6b7a8d' }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex justify-center my-3">
                  <div className="flex size-8 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.9)' }}>
                    <ArrowDown className="size-4" style={{ color: '#6b7a8d' }} />
                  </div>
                </div>

                {/* Destination — always Arc */}
                <div className="mb-3 rounded-xl px-4 py-3 flex items-center justify-between" style={glass.inner}>
                  <span className="text-sm font-semibold" style={{ color: '#0f1e2e' }}>Arc Mainnet</span>
                  <div className="flex items-center gap-1">
                    <TokenUSDC size={16} />
                    <span className="text-xs" style={{ color: '#6b7a8d' }}>USDC</span>
                  </div>
                </div>

                {/* Amount */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#6b7a8d' }}>Amount (USDC)</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={bridgeAmount}
                      onChange={e => setBridgeAmount(e.target.value)}
                      className="w-full rounded-xl px-4 py-3 text-xl font-bold tabular-nums outline-none pr-16"
                      style={{ ...glass.inner, color: '#0f1e2e' }}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <TokenUSDC size={16} />
                      <span className="text-xs font-semibold" style={{ color: '#6b7a8d' }}>USDC</span>
                    </div>
                  </div>
                </div>

                {/* Bridge steps progress */}
                {bridgeStep === 'bridging' && (
                  <div className="mb-4 flex flex-col gap-2">
                    {['approve', 'burn', 'fetchAttestation', 'mint'].map(stepName => {
                      const s = bridgeSteps.find(x => x.name === stepName)
                      const done = s?.state === 'success'
                      const active = bridgeStep === 'bridging' && !done && bridgeSteps.length > 0
                      return (
                        <div key={stepName} className="flex items-center gap-2 text-xs">
                          {done ? (
                            <CheckCircle2 className="size-4 shrink-0" style={{ color: '#22c55e' }} />
                          ) : active ? (
                            <Loader2 className="size-4 shrink-0 animate-spin" style={{ color: '#6b7a8d' }} />
                          ) : (
                            <div className="size-4 rounded-full border-2 shrink-0" style={{ borderColor: '#d1d5db' }} />
                          )}
                          <span style={{ color: done ? '#22c55e' : '#6b7a8d' }} className="capitalize">
                            {stepName === 'fetchAttestation' ? 'Attestation' : stepName}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!isConnected ? (
                  <div className="flex justify-center">
                    <ConnectKitButton />
                  </div>
                ) : (
                  <button
                    onClick={() => void handleBridge()}
                    disabled={!bridgeAmount || bridgeStep === 'bridging'}
                    className="w-full rounded-xl py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                    style={{ background: spectral }}
                  >
                    {bridgeStep === 'bridging' ? (
                      <><Loader2 className="size-4 animate-spin" /> Bridging...</>
                    ) : (
                      <><Zap className="size-4" /> Bridge {bridgeAmount ? `$${bridgeAmount}` : ''} to Arc</>
                    )}
                  </button>
                )}

                <p className="text-xs text-center mt-3" style={{ color: '#6b7a8d' }}>
                  Powered by Circle CCTP — ~20 seconds
                </p>
              </>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
        {tab === 'history' && (
          <div style={glass.card} className="p-5">
            <h2 className="display text-base font-bold mb-4" style={{ color: '#0f1e2e' }}>Payment History</h2>
            {history.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <Clock className="size-10" style={{ color: '#d1d5db' }} />
                <p className="text-sm" style={{ color: '#6b7a8d' }}>No payments yet</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {history.map(h => (
                  <a
                    key={h.hash}
                    href={`${EXPLORER}/tx/${h.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl px-4 py-3 transition-all hover:opacity-80"
                    style={glass.inner}
                  >
                    <div className="flex items-center gap-3">
                      <Send className="size-4 shrink-0" style={{ color: '#22c55e' }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#0f1e2e' }}>
                          ${h.amount} USDC
                        </p>
                        <p className="text-xs font-mono" style={{ color: '#6b7a8d' }}>
                          {h.to.slice(0, 8)}...{h.to.slice(-4)}
                          {h.note ? ` · ${h.note}` : ''}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0" style={{ color: '#d1d5db' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-8 text-center">
          <p className="text-xs" style={{ color: '#9ca3af' }}>
            BachatPay · USDC on{' '}
            <a href="https://arc.io" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7a8d' }}>Arc Mainnet</a>
            {' '}· Built with{' '}
            <a href="https://studio.arc.io" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7a8d' }}>Arc Studio</a>
          </p>
        </footer>
      </div>
    </div>
  )
}
