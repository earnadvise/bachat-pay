/**
 * BachatPay — Daily USDC payments on Arc. Like GPay, but onchain.
 * Built with Arc Studio — https://studio.arc.io
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { ConnectKitButton } from 'connectkit'
import {
  useAccount, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
  useConnectorClient,
} from 'wagmi'
import { erc20Abi, parseUnits, formatUnits, isAddress } from 'viem'
import { arc } from 'viem/chains'
import { toast } from 'sonner'
import {
  Send, QrCode, History, ArrowDownLeft, Star, StarOff,
  Copy, Share2, ExternalLink, Loader2, CheckCircle2, ScanLine,
  Users, ChevronRight, Zap, X, Wallet, PiggyBank as PiggyBankIcon,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { QRCodeSVG } from 'qrcode.react'
import { Html5Qrcode } from 'html5-qrcode'
import { buildShareLink } from './lib/share'
import VaultTab from './VaultTab'
import ChitFundTab from './ChitFundTab'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import type { EIP1193Provider } from 'viem'
import { base, arbitrum, optimism, polygon } from 'viem/chains'
import type { Chain } from 'viem'

// ── Constants ─────────────────────────────────────────────────────────────────
const ARC_CHAIN_ID = arc.id // 5042
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const EXPLORER = 'https://explorer.arc.io'

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 32px rgba(18,45,69,0.08), inset 0 1px 0 rgba(255,255,255,0.55)',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.50)',
    border: '1px solid rgba(255,255,255,0.60)',
  } as React.CSSProperties,
}

const QUICK_AMOUNTS = ['1', '5', '10', '20', '50']

type Tab = 'home' | 'pay' | 'receive' | 'history' | 'vault' | 'chit'

interface HistoryEntry {
  hash: string
  to: string
  amount: string
  note: string
  ts: number
  dir: 'out' | 'in'
}

interface Favourite {
  address: string
  name: string
}

// ── Bridge helpers ─────────────────────────────────────────────────────────────
const appKit = new AppKit()

interface BridgeChain { label: string; chain: Chain; kitName: string }
const BRIDGE_CHAINS: BridgeChain[] = [
  { label: 'Base', chain: base, kitName: 'Base' },
  { label: 'Arbitrum', chain: arbitrum, kitName: 'Arbitrum' },
  { label: 'Optimism', chain: optimism, kitName: 'OP Mainnet' },
  { label: 'Polygon', chain: polygon, kitName: 'Polygon' },
]

function withAddChainFallback(provider: EIP1193Provider, chains: Chain[]): EIP1193Provider {
  const send = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>
  const request = (async (args: { method: string; params?: unknown }) => {
    try { return await send(args) }
    catch (error) {
      const e = error as { code?: number }
      if (args.method !== 'wallet_switchEthereumChain' || e?.code !== 4902) throw error
      const [{ chainId }] = args.params as [{ chainId: string }]
      const ch = chains.find(c => c.id === Number(chainId))
      if (!ch) throw error
      await send({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: ch.name, nativeCurrency: ch.nativeCurrency, rpcUrls: [...ch.rpcUrls.default.http] }] })
      return send(args)
    }
  }) as EIP1193Provider['request']
  return new Proxy(provider, { get(t, p) { return p === 'request' ? request : typeof Reflect.get(t, p, t) === 'function' ? (Reflect.get(t, p, t) as CallableFunction).bind(t) : Reflect.get(t, p, t) } })
}

// ── Local storage helpers ──────────────────────────────────────────────────────
function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem('bachat_history') ?? '[]') as HistoryEntry[] } catch { return [] }
}
function loadFavourites(): Favourite[] {
  try { return JSON.parse(localStorage.getItem('bachat_favs') ?? '[]') as Favourite[] } catch { return [] }
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function App() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { data: connectorClient } = useConnectorClient()
  const [tab, setTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('to') ? 'pay' : 'home'
  })

  // ── USDC balance ──────────────────────────────────────────────────────────
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  })
  const onArc = chainId === ARC_CHAIN_ID
  const balanceDisplay = usdcBalance != null
    ? parseFloat(formatUnits(usdcBalance, USDC_DECIMALS)).toFixed(2)
    : onArc ? '…' : '—'

  // ── Live INR rate (CoinGecko, refreshes every 60s) ───────────────────────
  const [inrRate, setInrRate] = useState<number>(96) // fallback to current rate
  const [rateAge, setRateAge] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    const fetchRate = async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=inr',
          { signal: AbortSignal.timeout(5000) }
        )
        const json = await res.json() as { 'usd-coin': { inr: number } }
        if (!cancelled && json['usd-coin']?.inr) {
          setInrRate(json['usd-coin'].inr)
          setRateAge(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
        }
      } catch { /* keep fallback */ }
    }
    void fetchRate()
    const id = setInterval(() => void fetchRate(), 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const toInr = (usdc: string | number) => {
    const n = typeof usdc === 'string' ? parseFloat(usdc) : usdc
    if (isNaN(n)) return ''
    return `₹${(n * inrRate).toFixed(2)}`
  }

  // ── History & Favourites ──────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [favs, setFavs] = useState<Favourite[]>(loadFavourites)

  const saveEntry = useCallback((e: HistoryEntry) => {
    setHistory(prev => {
      const next = [e, ...prev].slice(0, 50)
      localStorage.setItem('bachat_history', JSON.stringify(next))
      return next
    })
  }, [])

  const toggleFav = useCallback((addr: string, name?: string) => {
    setFavs(prev => {
      const exists = prev.find(f => f.address.toLowerCase() === addr.toLowerCase())
      const next = exists
        ? prev.filter(f => f.address.toLowerCase() !== addr.toLowerCase())
        : [...prev, { address: addr, name: name ?? shortAddr(addr) }]
      localStorage.setItem('bachat_favs', JSON.stringify(next))
      return next
    })
  }, [])

  const isFav = (addr: string) => favs.some(f => f.address.toLowerCase() === addr.toLowerCase())

  // ── Pay tab ───────────────────────────────────────────────────────────────
  const [payTo, setPayTo] = useState(() => new URLSearchParams(window.location.search).get('to') ?? '')
  const [payAmount, setPayAmount] = useState(() => new URLSearchParams(window.location.search).get('amount') ?? '')
  const [payNote, setPayNote] = useState(() => new URLSearchParams(window.location.search).get('note') ?? '')
  const [payStep, setPayStep] = useState<'idle' | 'sending' | 'done'>('idle')
  const [payHash, setPayHash] = useState<`0x${string}` | undefined>()

  const { writeContractAsync: transferUsdc } = useWriteContract()
  const { isSuccess: transferSuccess } = useWaitForTransactionReceipt({ hash: payHash, chainId: ARC_CHAIN_ID })

  useEffect(() => {
    if (!transferSuccess || payStep !== 'sending' || !payHash) return
    setPayStep('done')
    saveEntry({ hash: payHash, to: payTo, amount: payAmount, note: payNote, ts: Date.now(), dir: 'out' })
    void refetchBalance()
    toast.success('Payment sent!')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferSuccess])

  const handlePay = useCallback(async () => {
    if (!address || !isAddress(payTo) || !payAmount) return
    if (chainId !== ARC_CHAIN_ID) { await switchChainAsync({ chainId: ARC_CHAIN_ID }); return }
    try {
      setPayStep('sending')
      const hash = await transferUsdc({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [payTo, parseUnits(payAmount, USDC_DECIMALS)],
        chainId: ARC_CHAIN_ID,
      })
      setPayHash(hash)
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Payment failed')
      setPayStep('idle')
    }
  }, [address, payTo, payAmount, payNote, chainId, switchChainAsync, transferUsdc])

  const resetPay = () => { setPayStep('idle'); setPayTo(''); setPayAmount(''); setPayNote(''); setPayHash(undefined) }

  // ── QR Scanner ────────────────────────────────────────────────────────────
  const [scanning, setScanning] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const scanDivId = 'qr-reader'

  const startScan = useCallback(async () => {
    setScanning(true)
    setTab('pay')
    await new Promise(r => setTimeout(r, 120))
    const scanner = new Html5Qrcode(scanDivId)
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          stopScan()
          try {
            const url = new URL(text)
            const to = url.searchParams.get('to')
            const amt = url.searchParams.get('amount')
            const note = url.searchParams.get('note')
            if (to && isAddress(to)) setPayTo(to)
            if (amt) setPayAmount(amt)
            if (note) setPayNote(note)
          } catch {
            if (isAddress(text)) setPayTo(text)
          }
          toast.success('QR scanned!')
        },
        () => { /* quiet scan errors */ },
      )
    } catch {
      stopScan()
      toast.error('Camera not available')
    }
  }, [])

  const stopScan = useCallback(() => {
    const s = scannerRef.current
    if (s) void (async () => { try { await s.stop() } catch { /* ignore */ } })()
    scannerRef.current = null
    setScanning(false)
  }, [])

  // ── Receive / QR tab ──────────────────────────────────────────────────────
  const [receiveAmount, setReceiveAmount] = useState('')
  const [shareLink, setShareLink] = useState('')

  useEffect(() => {
    if (!address) return
    void buildShareLink(`/?to=${address}${receiveAmount ? `&amount=${receiveAmount}` : ''}`).then(setShareLink)
  }, [address, receiveAmount])

  const handleShare = useCallback(async () => {
    if (!shareLink) return
    if (navigator.share) {
      try { await navigator.share({ title: 'Pay me via BachatPay', text: `Send me USDC on Arc`, url: shareLink }) }
      catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(shareLink)
      toast.success('Link copied!')
    }
  }, [shareLink])

  const handleWhatsApp = useCallback(() => {
    if (!shareLink) return
    const msg = encodeURIComponent(`Pay me ${receiveAmount ? `$${receiveAmount} USDC` : 'USDC'} via BachatPay: ${shareLink}`)
    window.open(`https://wa.me/?text=${msg}`, '_blank')
  }, [shareLink, receiveAmount])

  // ── Split bill ────────────────────────────────────────────────────────────
  const [splitTotal, setSplitTotal] = useState('')
  const [splitPeople, setSplitPeople] = useState('2')
  const [splitLink, setSplitLink] = useState('')
  const [showSplit, setShowSplit] = useState(false)

  useEffect(() => {
    if (!address || !splitTotal || !splitPeople) return
    const per = (parseFloat(splitTotal) / parseInt(splitPeople)).toFixed(2)
    void buildShareLink(`/?to=${address}&amount=${per}&note=Split+bill`).then(setSplitLink)
  }, [address, splitTotal, splitPeople])

  // ── Bridge ────────────────────────────────────────────────────────────────
  const [showBridge, setShowBridge] = useState(false)
  const [bridgeFrom, setBridgeFrom] = useState(BRIDGE_CHAINS[0])
  const [bridgeAmount, setBridgeAmount] = useState('')
  const [bridgeStep, setBridgeStep] = useState<'idle' | 'bridging' | 'done'>('idle')

  const handleBridge = useCallback(async () => {
    if (!connectorClient || !bridgeAmount) return
    if (chainId !== bridgeFrom.chain.id) {
      await switchChainAsync({ chainId: bridgeFrom.chain.id })
    }
    try {
      setBridgeStep('bridging')
      const rawProvider = (connectorClient.transport as unknown as { provider?: EIP1193Provider }).provider
      if (!rawProvider) throw new Error('No provider')
      const adapter = await createViemAdapterFromProvider({
        provider: withAddChainFallback(rawProvider, [arc, ...BRIDGE_CHAINS.map(b => b.chain)]),
      })
      await appKit.bridge({
        token: 'USDC',
        from: { adapter, chain: bridgeFrom.kitName as Parameters<typeof appKit.bridge>[0]['from']['chain'] },
        to: { adapter, chain: 'Arc' as Parameters<typeof appKit.bridge>[0]['to']['chain'] },
        amount: bridgeAmount,
      })
      setBridgeStep('done')
      void refetchBalance()
      toast.success(`Bridged ${bridgeAmount} USDC to Arc!`)
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Bridge failed')
      setBridgeStep('idle')
    }
  }, [connectorClient, bridgeAmount, bridgeFrom, chainId, switchChainAsync, refetchBalance])

  // ── Render ────────────────────────────────────────────────────────────────
  const recentContacts = [...new Map(
    history.filter(h => h.dir === 'out').map(h => [h.to, h])
  ).values()].slice(0, 5)

  return (
    <div className="relative min-h-dvh overflow-hidden" style={{ background: 'linear-gradient(160deg,#f0f7ff 0%,#fffdf7 50%,#f7f0ff 100%)' }}>
      {/* blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'5%', left:'10%', width:260, height:260, borderRadius:'50%', background:'radial-gradient(circle,rgba(100,170,255,0.18) 0%,transparent 70%)', filter:'blur(50px)' }} />
        <div style={{ position:'absolute', bottom:'12%', right:'5%', width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle,rgba(200,160,255,0.16) 0%,transparent 70%)', filter:'blur(50px)' }} />
      </div>

      {/* ── HEADER ── */}
      <header className="relative z-10 flex items-center justify-between px-4 pt-safe-top pb-3 pt-4" style={glass.card}>
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}>
            <TokenUSDC size={18} variant="branded" />
          </div>
          <span className="text-base font-bold tracking-tight" style={{ fontFamily:'Space Grotesk,sans-serif', color:'#0f1c35' }}>BachatPay</span>
        </div>
        <ConnectKitButton />
      </header>

      {/* ── CONTENT ── */}
      <main className="relative z-10 mx-auto max-w-md px-4 pb-28 pt-4 space-y-4">

        {/* HOME TAB */}
        {tab === 'home' && (
          <>
            {/* Wrong-chain banner */}
            {isConnected && !onArc && (
              <button
                onClick={() => void switchChainAsync({ chainId: ARC_CHAIN_ID })}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold"
                style={{ background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a' }}>
                <span>Switch to Arc mainnet to see balance and pay</span>
                <span className="text-xs underline">Switch now</span>
              </button>
            )}

            {/* Balance hero */}
            <div className="rounded-2xl p-5" style={glass.card}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color:'#6b7c99' }}>Your USDC Balance</p>
              <div className="flex items-end gap-2 mb-1">
                <span className="text-4xl font-bold tabular-nums" style={{ fontFamily:'Space Grotesk,sans-serif', color:'#0f1c35' }}>
                  {!isConnected ? 'Connect wallet' : !onArc ? 'Switch chain' : `$${balanceDisplay}`}
                </span>
                {isConnected && onArc && <span className="mb-1 text-sm font-semibold" style={{ color:'#6b7c99' }}>USDC</span>}
              </div>
              {isConnected && onArc && usdcBalance != null && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg font-semibold tabular-nums" style={{ color:'#16a34a' }}>
                    {toInr(balanceDisplay)}
                  </span>
                  <span className="text-xs" style={{ color:'#6b7c99' }}>
                    1 USDC = ₹{inrRate.toFixed(2)}{rateAge ? ` · ${rateAge}` : ''}
                  </span>
                </div>
              )}
              {/* Action row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { icon: <Send size={20} />, label: 'Send', action: () => setTab('pay') },
                  { icon: <QrCode size={20} />, label: 'Receive', action: () => setTab('receive') },
                  { icon: <ScanLine size={20} />, label: 'Scan', action: () => void startScan() },
                  { icon: <Zap size={20} />, label: 'Bridge', action: () => setShowBridge(true) },
                ].map(({ icon, label, action }) => (
                  <button key={label} onClick={action}
                    className="flex flex-col items-center gap-1 rounded-xl py-3 transition active:scale-95"
                    style={{ background:'rgba(59,130,246,0.08)', color:'#1d4ed8', minHeight:56 }}>
                    {icon}
                    <span className="text-xs font-semibold">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Favourites */}
            {favs.length > 0 && (
              <div className="rounded-2xl p-4" style={glass.card}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color:'#6b7c99' }}>Favourites</p>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {favs.map(f => (
                    <button key={f.address} onClick={() => { setPayTo(f.address); setTab('pay') }}
                      className="flex flex-col items-center gap-1 min-w-[60px] transition active:scale-95">
                      <div className="flex size-12 items-center justify-center rounded-full text-white text-base font-bold"
                        style={{ background:'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}>
                        {f.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium" style={{ color:'#0f1c35' }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recent */}
            {recentContacts.length > 0 && (
              <div className="rounded-2xl p-4" style={glass.card}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color:'#6b7c99' }}>Recent</p>
                <div className="space-y-2">
                  {recentContacts.map(h => (
                    <button key={h.to} onClick={() => { setPayTo(h.to); setTab('pay') }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition active:scale-95"
                      style={{ background:'rgba(255,255,255,0.5)' }}>
                      <div className="flex size-10 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0"
                        style={{ background:'linear-gradient(135deg,#10b981,#3b82f6)' }}>
                        {h.to.slice(2, 4).toUpperCase()}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-semibold" style={{ color:'#0f1c35' }}>{shortAddr(h.to)}</p>
                        <p className="text-xs" style={{ color:'#6b7c99' }}>${h.amount} USDC · {toInr(h.amount)} · {fmtDate(h.ts)}</p>
                      </div>
                      <ChevronRight size={14} style={{ color:'#6b7c99' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Split bill shortcut */}
            <button onClick={() => setShowSplit(true)}
              className="flex w-full items-center gap-3 rounded-2xl p-4 transition active:scale-95"
              style={glass.card}>
              <div className="flex size-10 items-center justify-center rounded-full" style={{ background:'rgba(16,185,129,0.12)', color:'#059669' }}>
                <Users size={20} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold" style={{ color:'#0f1c35' }}>Split Bill</p>
                <p className="text-xs" style={{ color:'#6b7c99' }}>Divide a bill and share payment links</p>
              </div>
              <ChevronRight size={16} style={{ color:'#6b7c99' }} />
            </button>

            {/* Connect prompt */}
            {!isConnected && (
              <div className="rounded-2xl p-5 text-center" style={glass.card}>
                <Wallet size={32} className="mx-auto mb-2" style={{ color:'#3b82f6' }} />
                <p className="font-semibold mb-1" style={{ color:'#0f1c35' }}>Connect your wallet</p>
                <p className="text-sm mb-3" style={{ color:'#6b7c99' }}>Use MetaMask, Coinbase Wallet, or scan with your phone</p>
                <ConnectKitButton />
              </div>
            )}
          </>
        )}

        {/* PAY TAB */}
        {tab === 'pay' && (
          <div className="rounded-2xl p-5" style={glass.card}>
            {payStep === 'done' && payHash ? (
              <div className="text-center py-4">
                <CheckCircle2 size={48} className="mx-auto mb-3" style={{ color:'#10b981' }} />
                <p className="text-lg font-bold mb-1" style={{ color:'#0f1c35' }}>Sent!</p>
                <p className="text-sm mb-4" style={{ color:'#6b7c99' }}>${payAmount} USDC {payAmount ? `(${toInr(payAmount)})` : ''} to {shortAddr(payTo)}</p>
                <div className="flex gap-2 justify-center">
                  <a href={`${EXPLORER}/tx/${payHash}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold"
                    style={{ background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                    <ExternalLink size={14} /> Explorer
                  </a>
                  <button onClick={resetPay}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                    style={{ background:'#1d4ed8' }}>
                    Send Again
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-base" style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}>Send USDC</h2>
                  <button onClick={() => void startScan()} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold"
                    style={{ background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                    <ScanLine size={14} /> Scan QR
                  </button>
                </div>

                {/* QR scanner viewport */}
                {scanning && (
                  <div className="relative mb-4 rounded-xl overflow-hidden" style={{ height: 260 }}>
                    <div id={scanDivId} className="w-full h-full" />
                    <button onClick={stopScan}
                      className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full"
                      style={{ background:'rgba(0,0,0,0.5)', color:'white' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* To address */}
                <div className="mb-3" style={glass.inner}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>To</label>
                    <input
                      value={payTo}
                      onChange={e => setPayTo(e.target.value)}
                      placeholder="0x wallet address"
                      className="w-full bg-transparent text-sm outline-none font-mono"
                      style={{ color:'#0f1c35' }}
                    />
                  </div>
                </div>

                {/* Favourites quick-select */}
                {favs.length > 0 && !payTo && (
                  <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
                    {favs.map(f => (
                      <button key={f.address} onClick={() => setPayTo(f.address)}
                        className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
                        style={{ background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Amount */}
                <div className="mb-3" style={glass.inner}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Amount (USDC)</label>
                    <input
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      placeholder="0.00"
                      type="number"
                      inputMode="decimal"
                      className="w-full bg-transparent text-2xl font-bold outline-none tabular-nums"
                      style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}
                    />
                  </div>
                </div>

                {/* Quick chips */}
                <div className="flex gap-2 mb-3 flex-wrap">
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} onClick={() => setPayAmount(a)}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95"
                      style={payAmount === a
                        ? { background:'#1d4ed8', color:'white' }
                        : { background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                      ${a}
                    </button>
                  ))}
                </div>

                {/* Note */}
                <div className="mb-4" style={glass.inner}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Note (optional)</label>
                    <input
                      value={payNote}
                      onChange={e => setPayNote(e.target.value)}
                      placeholder="Groceries, chai, rent…"
                      className="w-full bg-transparent text-sm outline-none"
                      style={{ color:'#0f1c35' }}
                    />
                  </div>
                </div>

                {/* Fav toggle */}
                {isAddress(payTo) && (
                  <button onClick={() => toggleFav(payTo)}
                    className="flex items-center gap-1.5 mb-4 text-xs font-semibold"
                    style={{ color: isFav(payTo) ? '#f59e0b' : '#6b7c99' }}>
                    {isFav(payTo) ? <Star size={14} /> : <StarOff size={14} />}
                    {isFav(payTo) ? 'Saved to favourites' : 'Save to favourites'}
                  </button>
                )}

                {/* Wrong-chain warning on Pay tab */}
                {isConnected && !onArc && (
                  <button
                    onClick={() => void switchChainAsync({ chainId: ARC_CHAIN_ID })}
                    className="flex w-full items-center justify-between rounded-xl px-4 py-3 mb-3 text-sm font-semibold"
                    style={{ background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a' }}>
                    <span>You're on the wrong network</span>
                    <span className="text-xs underline">Switch to Arc</span>
                  </button>
                )}

                {/* Pay button */}
                <button
                  onClick={() => void handlePay()}
                  disabled={!isConnected || !onArc || !isAddress(payTo) || !payAmount || payStep === 'sending'}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition active:scale-95 disabled:opacity-50"
                  style={{ background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', minHeight:56 }}>
                  {payStep === 'sending'
                    ? <><Loader2 size={18} className="animate-spin" /> Sending…</>
                    : <><Send size={18} /> Pay {payAmount ? `$${payAmount}` : ''} USDC</>}
                </button>
                {/* Hint under pay button */}
                {isConnected && onArc && (!isAddress(payTo) || !payAmount) && (
                  <p className="text-center text-xs mt-2" style={{ color:'#6b7c99' }}>
                    {!payTo ? 'Enter a recipient address or scan their QR code' : !isAddress(payTo) ? 'Enter a valid wallet address (0x…)' : 'Enter an amount to continue'}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* RECEIVE TAB */}
        {tab === 'receive' && (
          <div className="rounded-2xl p-5 text-center" style={glass.card}>
            <h2 className="font-bold text-base mb-4" style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}>Receive USDC</h2>

            {address ? (
              <>
                <div className="mx-auto mb-4 rounded-2xl p-4 inline-block" style={{ background:'white' }}>
                  <QRCodeSVG value={shareLink || `https://bachat-pay.vercel.app/?to=${address}`} size={200} />
                </div>
                <p className="text-xs font-mono mb-4 px-2 break-all" style={{ color:'#6b7c99' }}>{address}</p>

                {/* Request amount */}
                <div className="mb-4 text-left" style={glass.inner}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Request amount (optional)</label>
                    <input
                      value={receiveAmount}
                      onChange={e => setReceiveAmount(e.target.value)}
                      placeholder="0.00"
                      type="number"
                      inputMode="decimal"
                      className="w-full bg-transparent text-xl font-bold outline-none tabular-nums"
                      style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}
                    />
                  </div>
                </div>

                {/* Quick receive chips */}
                <div className="flex gap-2 mb-4 justify-center flex-wrap">
                  {QUICK_AMOUNTS.map(a => (
                    <button key={a} onClick={() => setReceiveAmount(a)}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold"
                      style={receiveAmount === a
                        ? { background:'#1d4ed8', color:'white' }
                        : { background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                      ${a}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => { void navigator.clipboard.writeText(shareLink); toast.success('Link copied!') }}
                    className="flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-semibold"
                    style={{ background:'rgba(59,130,246,0.08)', color:'#1d4ed8' }}>
                    <Copy size={18} /> Copy
                  </button>
                  <button onClick={() => void handleShare()}
                    className="flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-semibold"
                    style={{ background:'rgba(59,130,246,0.08)', color:'#1d4ed8' }}>
                    <Share2 size={18} /> Share
                  </button>
                  <button onClick={handleWhatsApp}
                    className="flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-semibold"
                    style={{ background:'rgba(37,211,102,0.1)', color:'#16a34a' }}>
                    <span className="text-lg leading-none">💬</span> WhatsApp
                  </button>
                </div>
              </>
            ) : (
              <div className="py-8">
                <p className="text-sm mb-4" style={{ color:'#6b7c99' }}>Connect your wallet to show your QR code</p>
                <ConnectKitButton />
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div className="rounded-2xl p-4" style={glass.card}>
            <h2 className="font-bold text-base mb-4" style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}>Transaction History</h2>
            {history.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color:'#6b7c99' }}>No transactions yet</p>
            ) : (
              <div className="space-y-2">
                {history.map(h => (
                  <a key={h.hash} href={`${EXPLORER}/tx/${h.hash}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition active:scale-95"
                    style={{ background:'rgba(255,255,255,0.5)' }}>
                    <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full"
                      style={{ background: h.dir === 'out' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: h.dir === 'out' ? '#dc2626' : '#059669' }}>
                      {h.dir === 'out' ? <Send size={16} /> : <ArrowDownLeft size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color:'#0f1c35' }}>
                        {h.dir === 'out' ? `To ${shortAddr(h.to)}` : `From ${shortAddr(h.to)}`}
                      </p>
                      <p className="text-xs truncate" style={{ color:'#6b7c99' }}>
                        {h.note || 'USDC transfer'} · {fmtDate(h.ts)}
                      </p>
                    </div>
                    <span className="text-sm font-bold flex-shrink-0" style={{ color: h.dir === 'out' ? '#dc2626' : '#059669' }}>
                      {h.dir === 'out' ? '-' : '+'}${h.amount}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── VAULT TAB ── */}
        {tab === 'vault' && <VaultTab toInr={toInr} />}

        {/* ── CHIT FUND TAB ── */}
        {tab === 'chit' && <ChitFundTab toInr={toInr} />}

      </main>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 inset-x-0 z-20 pb-safe-bottom" style={glass.card}>
        <div className="mx-auto max-w-md flex">
          {([
            { id: 'home', icon: <Wallet size={18} />, label: 'Home' },
            { id: 'pay', icon: <Send size={18} />, label: 'Pay' },
            { id: 'receive', icon: <QrCode size={18} />, label: 'Receive' },
            { id: 'vault', icon: <PiggyBankIcon size={18} />, label: 'Vault' },
            { id: 'chit', icon: <Users size={18} />, label: 'Chit' },
            { id: 'history', icon: <History size={18} />, label: 'History' },
          ] as { id: Tab; icon: React.ReactNode; label: string }[]).map(({ id, icon, label }) => (
            <button key={id} onClick={() => setTab(id)}
              className="flex flex-1 flex-col items-center gap-0.5 py-3 transition"
              style={{ color: tab === id ? '#1d4ed8' : '#9ca3af', minHeight: 60 }}>
              {icon}
              <span className="text-xs font-semibold">{label}</span>
              {tab === id && <div className="h-0.5 w-6 rounded-full mt-0.5" style={{ background:'#1d4ed8' }} />}
            </button>
          ))}
        </div>
      </nav>

      {/* ── SPLIT BILL SHEET ── */}
      {showSplit && (
        <div className="fixed inset-0 z-30 flex items-end" style={{ background:'rgba(0,0,0,0.4)' }} onClick={() => setShowSplit(false)}>
          <div className="w-full rounded-t-3xl p-6" style={{ ...glass.card, maxWidth:448, margin:'0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="mb-1 h-1 w-10 rounded-full mx-auto" style={{ background:'#d1d5db' }} />
            <h3 className="font-bold text-base mb-4 mt-2" style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}>Split Bill</h3>

            <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Total amount ($)</label>
            <input value={splitTotal} onChange={e => setSplitTotal(e.target.value)}
              placeholder="0.00" type="number" inputMode="decimal"
              className="w-full rounded-xl p-3 mb-3 text-xl font-bold outline-none tabular-nums"
              style={{ ...glass.inner, color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }} />

            <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Number of people</label>
            <div className="flex gap-2 mb-4">
              {['2','3','4','5','6'].map(n => (
                <button key={n} onClick={() => setSplitPeople(n)}
                  className="flex-1 rounded-xl py-2.5 text-sm font-bold transition"
                  style={splitPeople === n ? { background:'#1d4ed8', color:'white' } : { background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                  {n}
                </button>
              ))}
            </div>

            {splitTotal && splitPeople && (
              <div className="mb-4 rounded-xl p-3 text-center" style={{ background:'rgba(59,130,246,0.08)' }}>
                <p className="text-xs" style={{ color:'#6b7c99' }}>Each person pays</p>
                <p className="text-2xl font-bold" style={{ color:'#1d4ed8', fontFamily:'Space Grotesk,sans-serif' }}>
                  ${(parseFloat(splitTotal || '0') / parseInt(splitPeople || '1')).toFixed(2)}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { void navigator.clipboard.writeText(splitLink); toast.success('Split link copied!') }}
                className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
                style={{ background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                <Copy size={16} /> Copy Link
              </button>
              <button onClick={() => {
                const msg = encodeURIComponent(`Pay your share: ${splitLink}`)
                window.open(`https://wa.me/?text=${msg}`, '_blank')
              }}
                className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
                style={{ background:'#25d366' }}>
                <span>💬</span> WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BRIDGE SHEET ── */}
      {showBridge && (
        <div className="fixed inset-0 z-30 flex items-end" style={{ background:'rgba(0,0,0,0.4)' }} onClick={() => setShowBridge(false)}>
          <div className="w-full rounded-t-3xl p-6" style={{ ...glass.card, maxWidth:448, margin:'0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="mb-1 h-1 w-10 rounded-full mx-auto" style={{ background:'#d1d5db' }} />
            <h3 className="font-bold text-base mb-1 mt-2" style={{ color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }}>Bridge USDC to Arc</h3>
            <p className="text-xs mb-4" style={{ color:'#6b7c99' }}>Move USDC from another chain to Arc for near-zero fees</p>

            <label className="text-xs font-semibold mb-2 block" style={{ color:'#6b7c99' }}>From chain</label>
            <div className="flex gap-2 mb-4 flex-wrap">
              {BRIDGE_CHAINS.map(b => (
                <button key={b.label} onClick={() => setBridgeFrom(b)}
                  className="rounded-xl px-3 py-2 text-xs font-bold transition"
                  style={bridgeFrom.label === b.label ? { background:'#1d4ed8', color:'white' } : { background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                  {b.label}
                </button>
              ))}
            </div>

            <label className="text-xs font-semibold mb-1 block" style={{ color:'#6b7c99' }}>Amount (USDC)</label>
            <input value={bridgeAmount} onChange={e => setBridgeAmount(e.target.value)}
              placeholder="0.00" type="number" inputMode="decimal"
              className="w-full rounded-xl p-3 mb-4 text-xl font-bold outline-none tabular-nums"
              style={{ ...glass.inner, color:'#0f1c35', fontFamily:'Space Grotesk,sans-serif' }} />

            <button onClick={() => void handleBridge()}
              disabled={!isConnected || !bridgeAmount || bridgeStep === 'bridging'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white disabled:opacity-50"
              style={{ background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', minHeight:56 }}>
              {bridgeStep === 'bridging'
                ? <><Loader2 size={18} className="animate-spin" /> Bridging…</>
                : bridgeStep === 'done'
                  ? <><CheckCircle2 size={18} /> Bridged!</>
                  : <>Bridge {bridgeAmount ? `$${bridgeAmount}` : ''} USDC to Arc</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
