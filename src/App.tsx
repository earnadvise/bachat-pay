/**
 * BachatPay — Daily USDC payments on Arc. Like GPay, but onchain.
 * Built with Arc Studio — https://studio.arc.io
 */

import LandingPage from './LandingPage'
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
import { lazy, Suspense } from 'react'
const VaultTab = lazy(() => import('./VaultTab'))
const ChitFundTab = lazy(() => import('./ChitFundTab'))
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
const ARC_EXPLORER_API = 'https://explorer.arc.io/api/v2'

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

// ── Root component — routes between landing and app ───────────────────────────
export default function App() {
  const [showLanding, setShowLanding] = useState(() =>
    !new URLSearchParams(window.location.search).get('to')
  )
  if (showLanding) return <LandingPage onEnterApp={() => setShowLanding(false)} />
  return <AppMain onGoBack={() => setShowLanding(true)} />
}

// ── Main app ───────────────────────────────────────────────────────────────────
function AppMain({ onGoBack }: { onGoBack: () => void }) {
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

  // ── Dark mode ──────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('bachat_dark') === '1')
  const toggleDark = () => setDarkMode(d => { localStorage.setItem('bachat_dark', d ? '0' : '1'); return !d })

  // ── Onchain history from Arc explorer ─────────────────────────────────────
  const [onchainHistory, setOnchainHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  useEffect(() => {
    if (!address) return
    setHistoryLoading(true)
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(
          `${ARC_EXPLORER_API}/addresses/${address}/token-transfers?token=${USDC_ADDRESS}&limit=20`,
          { signal: ctrl.signal }
        )
        if (!res.ok) return
        const data = await res.json() as { items?: Array<{ transaction_hash: string; from: { hash: string }; to: { hash: string }; total: { value: string; decimals: string }; timestamp: string }> }
        const items: HistoryEntry[] = (data.items ?? []).map(tx => ({
          hash: tx.transaction_hash,
          to: tx.from.hash.toLowerCase() === address.toLowerCase() ? tx.to.hash : tx.from.hash,
          amount: (parseInt(tx.total.value) / 10 ** parseInt(tx.total.decimals)).toFixed(2),
          note: 'USDC transfer',
          ts: new Date(tx.timestamp).getTime(),
          dir: tx.from.hash.toLowerCase() === address.toLowerCase() ? 'out' : 'in',
        }))
        if (!ctrl.signal.aborted) setOnchainHistory(items)
      } catch { /* ignore */ }
      finally { if (!ctrl.signal.aborted) setHistoryLoading(false) }
    })()
    return () => ctrl.abort()
  }, [address])

  // merged history: onchain first, then local-only entries not in onchain
  const mergedHistory = [
    ...onchainHistory,
    ...history.filter(h => !onchainHistory.find(o => o.hash === h.hash)),
  ].sort((a, b) => b.ts - a.ts).slice(0, 50)

  // ── Recent contacts (saved from pay history) ───────────────────────────────
  const saveRecentContact = useCallback((addr: string) => {
    try {
      const key = 'bachat_recents'
      const prev: string[] = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      const next = [addr, ...prev.filter(a => a !== addr)].slice(0, 8)
      localStorage.setItem(key, JSON.stringify(next))
      setRecentAddrs(next)
    } catch { /* ignore */ }
  }, [])
  const [recentAddrs, setRecentAddrs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('bachat_recents') ?? '[]') as string[] } catch { return [] }
  })

  // ── Pay tab ───────────────────────────────────────────────────────────────
  const [payTo, setPayTo] = useState(() => new URLSearchParams(window.location.search).get('to') ?? '')
  const [payAmount, setPayAmount] = useState(() => new URLSearchParams(window.location.search).get('amount') ?? '')
  const [payNote, setPayNote] = useState(() => new URLSearchParams(window.location.search).get('note') ?? '')
  const [payStep, setPayStep] = useState<'idle' | 'sending' | 'done'>('idle')
  const [payHash, setPayHash] = useState<`0x${string}` | undefined>()
  const [payInrMode, setPayInrMode] = useState(false)
  const [payInrAmount, setPayInrAmount] = useState('')

  // ── Gas estimate ───────────────────────────────────────────────────────────
  const [gasEst, setGasEst] = useState<string>('')
  useEffect(() => {
    if (!isAddress(payTo) || !payAmount || !address) { setGasEst(''); return }
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch('https://rpc.mainnet.arc.io', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_gasPrice', params:[] }),
        })
        const j = await res.json() as { result: string }
        const gasPriceWei = parseInt(j.result, 16)
        const gasUnits = 65000
        const gasCostUSDC = (gasPriceWei * gasUnits) / 1e18
        const display = gasCostUSDC < 0.001 ? '<$0.001' : `~$${gasCostUSDC.toFixed(4)}`
        if (!ctrl.signal.aborted) setGasEst(display)
      } catch { if (!ctrl.signal.aborted) setGasEst('') }
    })()
    return () => ctrl.abort()
  }, [payTo, payAmount, address])

  const { writeContractAsync: transferUsdc } = useWriteContract()
  const { isSuccess: transferSuccess } = useWaitForTransactionReceipt({ hash: payHash, chainId: ARC_CHAIN_ID })

  useEffect(() => {
    if (!transferSuccess || payStep !== 'sending' || !payHash) return
    setPayStep('done')
    saveEntry({ hash: payHash, to: payTo, amount: payAmount, note: payNote, ts: Date.now(), dir: 'out' })
    saveRecentContact(payTo)
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

  const resetPay = () => { setPayStep('idle'); setPayTo(''); setPayAmount(''); setPayNote(''); setPayHash(undefined); setPayInrAmount('') }

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

  // Stop scanner when wallet connects (QR overlay would otherwise persist)
  useEffect(() => {
    if (isConnected && scanning) stopScan()
  }, [isConnected, scanning, stopScan])

  // ── Receive / QR tab ──────────────────────────────────────────────────────
  const [receiveAmount, setReceiveAmount] = useState('')
  const [shareLink, setShareLink] = useState('')
  const [shopName, setShopName] = useState(() => localStorage.getItem('bachat_shopName') ?? '')
  const qrCardRef = useRef<HTMLDivElement>(null)

  const handleDownloadQR = useCallback(() => {
    const card = qrCardRef.current
    if (!card) return
    const svg = card.querySelector('svg')
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const W = 300, pad = 28
    const nameH = shopName ? 56 : 0
    const amtH = receiveAmount ? 32 : 0
    const qSize = W - pad * 2
    const H = pad + nameH + qSize + 32 + amtH + pad
    const canvas = document.createElement('canvas')
    canvas.width = W * 2; canvas.height = H * 2
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(2, 2)
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, W, H)
    grad.addColorStop(0, '#1e3a8a'); grad.addColorStop(1, '#4c1d95')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 18); ctx.fill()
    // Shop name
    let y = pad
    if (shopName) {
      ctx.textAlign = 'center'
      ctx.font = `800 ${shopName.length > 18 ? 17 : 21}px Arial, sans-serif`
      ctx.fillStyle = '#93c5fd'
      ctx.fillText(shopName, W / 2, y + 30)
      y += nameH
    }
    // White QR background
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.roundRect(pad, y, qSize, qSize, 12); ctx.fill()
    // Draw QR SVG
    const img = new Image()
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      ctx.drawImage(img, pad + 8, y + 8, qSize - 16, qSize - 16)
      URL.revokeObjectURL(url)
      y += qSize
      // Footer
      ctx.font = '500 11px Arial, sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.fillText('Scan to pay USDC on Arc · BachatPay', W / 2, y + 20)
      y += 32
      // Amount
      if (receiveAmount) {
        ctx.font = '700 14px Arial, sans-serif'
        ctx.fillStyle = 'white'
        ctx.fillText(`₹${(parseFloat(receiveAmount) * inrRate).toFixed(0)}  ·  $${receiveAmount} USDC`, W / 2, y + 16)
      }
      const a = document.createElement('a')
      a.download = `${shopName || 'bachatpay'}-payment-qr.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
      toast.success('QR downloaded!')
    }
    img.src = url
  }, [shopName, receiveAmount, inrRate])

  const handlePrintQR = useCallback(() => {
    const card = qrCardRef.current
    if (!card) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<html><head><title>BachatPay QR — ${shopName || 'Payment'}</title><style>
      body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff;font-family:'Space Grotesk',sans-serif;}
      .card{padding:32px;border-radius:20px;background:linear-gradient(135deg,#1e3a8a,#1e1b4b);text-align:center;display:inline-block;}
      .name{font-size:24px;font-weight:800;color:#93c5fd;margin-bottom:12px;}
      .qr-wrap{background:white;border-radius:16px;padding:12px;display:inline-block;}
      .footer{color:rgba(255,255,255,0.7);font-size:12px;margin-top:10px;}
      @media print{body{background:#fff;}@page{margin:1cm;}}
    </style></head><body><div class="card">
      ${shopName ? `<div class="name">${shopName}</div>` : ''}
      <div class="qr-wrap">${card.querySelector('svg')?.outerHTML ?? ''}</div>
      <div class="footer">Scan to pay USDC on Arc · BachatPay</div>
    </div></body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }, [shopName])

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

  const dk = darkMode
  const bg = dk ? { background: 'linear-gradient(160deg,#0f1c35 0%,#1a0a2e 50%,#0d1a2e 100%)' } : { background: 'linear-gradient(160deg,#f0f7ff 0%,#fffdf7 50%,#f7f0ff 100%)' }
  const cardStyle = dk ? { background:'rgba(255,255,255,0.06)', backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)', border:'1px solid rgba(255,255,255,0.10)', boxShadow:'0 8px 32px rgba(0,0,0,0.4)' } as React.CSSProperties : glass.card
  const innerStyle = dk ? { background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.12)' } as React.CSSProperties : glass.inner
  const textMain = dk ? '#e8f0ff' : '#0f1c35'
  const textMuted = dk ? '#8ba3c7' : '#6b7c99'

  return (
    <div className="relative min-h-dvh overflow-hidden" style={bg}>
      {/* blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position:'absolute', top:'5%', left:'10%', width:260, height:260, borderRadius:'50%', background: dk ? 'radial-gradient(circle,rgba(59,130,246,0.15) 0%,transparent 70%)' : 'radial-gradient(circle,rgba(100,170,255,0.18) 0%,transparent 70%)', filter:'blur(50px)' }} />
        <div style={{ position:'absolute', bottom:'12%', right:'5%', width:220, height:220, borderRadius:'50%', background: dk ? 'radial-gradient(circle,rgba(139,92,246,0.15) 0%,transparent 70%)' : 'radial-gradient(circle,rgba(200,160,255,0.16) 0%,transparent 70%)', filter:'blur(50px)' }} />
      </div>

      {/* ── HEADER ── */}
      <header className="relative z-10 flex items-center justify-between px-4 pt-safe-top pb-3 pt-4" style={cardStyle}>
        <button
          onClick={onGoBack}
          className="flex items-center gap-2 rounded-xl px-2 py-1 transition-opacity hover:opacity-70 active:opacity-50"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          title="Back to home"
        >
          <div className="flex size-8 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}>
            <TokenUSDC size={18} variant="branded" />
          </div>
          <span className="text-base font-bold tracking-tight" style={{ fontFamily:'Space Grotesk,sans-serif', color:textMain }}>BachatPay</span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={toggleDark} className="flex size-8 items-center justify-center rounded-full text-lg transition active:scale-90" style={{ background: dk ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }} title="Toggle dark mode">
            {dk ? '☀️' : '🌙'}
          </button>
          <ConnectKitButton />
        </div>
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
            <div className="rounded-3xl overflow-hidden" style={{ ...cardStyle, padding: 0 }}>
              {/* Top gradient strip */}
              <div style={{ background: 'linear-gradient(135deg,#1d4ed8 0%,#7c3aed 100%)', padding: '20px 20px 28px' }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TokenUSDC size={20} variant="branded" />
                    <span className="text-xs font-bold tracking-widest uppercase" style={{ color:'rgba(255,255,255,0.7)' }}>USDC Balance</span>
                  </div>
                  {isConnected && onArc && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:'rgba(255,255,255,0.15)', color:'white' }}>Arc Mainnet</span>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <span className="bp-balance text-5xl font-bold tabular-nums" style={{ fontFamily:'Space Grotesk,sans-serif', color:'white', letterSpacing:'-0.03em' }}>
                    {!isConnected ? '—' : !onArc ? '—' : `$${balanceDisplay}`}
                  </span>
                </div>
                {isConnected && onArc && usdcBalance != null && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-base font-semibold tabular-nums" style={{ color:'rgba(255,255,255,0.85)' }}>
                      {toInr(balanceDisplay)}
                    </span>
                    <span className="text-xs" style={{ color:'rgba(255,255,255,0.5)' }}>
                      1 USDC = ₹{inrRate.toFixed(2)}{rateAge ? ` · ${rateAge}` : ''}
                    </span>
                  </div>
                )}
                {!isConnected && (
                  <p className="text-sm mt-1" style={{ color:'rgba(255,255,255,0.6)' }}>Connect wallet to see balance</p>
                )}
              </div>
              {/* Action row */}
              <div className="grid grid-cols-4 gap-0 p-3" style={{ background: dk ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)' }}>
                {[
                  { icon: <Send size={18} />, label: 'Send', action: () => setTab('pay'), color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                  { icon: <QrCode size={18} />, label: 'Receive', action: () => setTab('receive'), color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
                  { icon: <ScanLine size={18} />, label: 'Scan', action: () => void startScan(), color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
                  { icon: <Zap size={18} />, label: 'Bridge', action: () => setShowBridge(true), color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
                ].map(({ icon, label, action, color, bg }) => (
                  <button key={label} onClick={action}
                    className="flex flex-col items-center gap-1.5 rounded-2xl py-3 transition active:scale-95">
                    <div className="flex size-10 items-center justify-center rounded-full" style={{ background: bg, color }}>
                      {icon}
                    </div>
                    <span className="text-xs font-semibold" style={{ color:textMain }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Favourites */}
            {favs.length > 0 && (
              <div className="rounded-2xl p-4" style={cardStyle}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color:textMuted }}>Favourites</p>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {favs.map(f => (
                    <button key={f.address} onClick={() => { setPayTo(f.address); setTab('pay') }}
                      className="flex flex-col items-center gap-1 min-w-[60px] transition active:scale-95">
                      <div className="flex size-12 items-center justify-center rounded-full text-white text-base font-bold"
                        style={{ background:'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}>
                        {f.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium" style={{ color:textMain }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recent */}
            {recentContacts.length > 0 && (
              <div className="rounded-2xl p-4" style={cardStyle}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color:textMuted }}>Recent</p>
                <div className="space-y-2">
                  {recentContacts.map(h => (
                    <button key={h.to} onClick={() => { setPayTo(h.to); setTab('pay') }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition active:scale-95"
                      style={{ background: dk ? 'rgba(255,255,255,0.07)' : 'rgba(59,130,246,0.06)', border: `1px solid ${dk ? 'rgba(255,255,255,0.08)' : 'rgba(59,130,246,0.1)'}` }}>
                      <div className="flex size-10 items-center justify-center rounded-full text-white text-sm font-bold flex-shrink-0"
                        style={{ background:'linear-gradient(135deg,#10b981,#3b82f6)' }}>
                        {h.to.slice(2, 4).toUpperCase()}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-semibold" style={{ color:textMain }}>{shortAddr(h.to)}</p>
                        <p className="text-xs" style={{ color:textMuted }}>${h.amount} USDC · {toInr(h.amount)} · {fmtDate(h.ts)}</p>
                      </div>
                      <ChevronRight size={14} style={{ color:textMuted }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Split bill shortcut */}
            <button onClick={() => setShowSplit(true)}
              className="flex w-full items-center gap-3 rounded-2xl p-4 transition active:scale-95"
              style={cardStyle}>
              <div className="flex size-10 items-center justify-center rounded-full" style={{ background:'rgba(16,185,129,0.12)', color:'#059669' }}>
                <Users size={20} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold" style={{ color:textMain }}>Split Bill</p>
                <p className="text-xs" style={{ color:textMuted }}>Divide a bill and share payment links</p>
              </div>
              <ChevronRight size={16} style={{ color:textMuted }} />
            </button>

            {/* Connect prompt — wallet button is already in the header; just show a hint */}
            {!isConnected && (
              <div className="rounded-2xl p-5 text-center" style={cardStyle}>
                <Wallet size={32} className="mx-auto mb-2" style={{ color:'#3b82f6' }} />
                <p className="font-semibold mb-1" style={{ color:textMain }}>Connect your wallet</p>
                <p className="text-sm" style={{ color:textMuted }}>Tap "Connect Wallet" in the top-right corner to get started</p>
              </div>
            )}
          </>
        )}

        {/* PAY TAB */}
        {tab === 'pay' && (
          <div className="rounded-2xl p-5" style={cardStyle}>
            {payStep === 'done' && payHash ? (
              <div className="text-center py-4">
                <CheckCircle2 size={48} className="mx-auto mb-3" style={{ color:'#10b981' }} />
                <p className="text-lg font-bold mb-1" style={{ color:textMain }}>Sent!</p>
                <p className="text-sm mb-4" style={{ color:textMuted }}>${payAmount} USDC {payAmount ? `(${toInr(payAmount)})` : ''} to {shortAddr(payTo)}</p>
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
                  <h2 className="font-bold text-base" style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}>Send USDC</h2>
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
                <div className="mb-3" style={innerStyle}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>To</label>
                    <input
                      value={payTo}
                      onChange={e => setPayTo(e.target.value)}
                      placeholder="0x wallet address"
                      className="w-full bg-transparent text-sm outline-none font-mono"
                      style={{ color:textMain }}
                    />
                  </div>
                </div>

                {/* Favourites + recents quick-select */}
                {!payTo && (favs.length > 0 || recentAddrs.length > 0) && (
                  <div className="mb-3">
                    {favs.length > 0 && (
                      <>
                        <p className="text-xs font-semibold mb-1.5" style={{ color:textMuted }}>Favourites</p>
                        <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
                          {favs.map(f => (
                            <button key={f.address} onClick={() => setPayTo(f.address)}
                              className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                              style={{ background:'rgba(245,158,11,0.12)', color:'#b45309' }}>
                              ⭐ {f.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {recentAddrs.filter(a => !favs.find(f => f.address === a)).length > 0 && (
                      <>
                        <p className="text-xs font-semibold mb-1.5" style={{ color:textMuted }}>Recent</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {recentAddrs.filter(a => !favs.find(f => f.address === a)).slice(0, 5).map(a => (
                            <button key={a} onClick={() => setPayTo(a)}
                              className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
                              style={{ background:'rgba(59,130,246,0.10)', color:'#1d4ed8' }}>
                              {shortAddr(a)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Amount with INR toggle */}
                <div className="mb-3" style={innerStyle}>
                  <div className="rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold" style={{ color:textMuted }}>{payInrMode ? 'Amount (₹ INR)' : 'Amount (USDC)'}</label>
                      <button onClick={() => { setPayInrMode(m => !m); setPayInrAmount(''); setPayAmount('') }}
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background:'rgba(59,130,246,0.12)', color:'#1d4ed8' }}>
                        {payInrMode ? 'Switch to USDC' : 'Enter in ₹'}
                      </button>
                    </div>
                    {payInrMode ? (
                      <>
                        <input
                          value={payInrAmount}
                          onChange={e => { setPayInrAmount(e.target.value); setPayAmount(inrRate > 0 ? (parseFloat(e.target.value || '0') / inrRate).toFixed(4) : '') }}
                          placeholder="0"
                          type="number"
                          inputMode="decimal"
                          className="bp-input w-full bg-transparent text-2xl font-bold outline-none tabular-nums"
                          style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}
                        />
                        {payAmount && parseFloat(payAmount) > 0 && (
                          <p className="text-xs mt-1" style={{ color:textMuted }}>${parseFloat(payAmount).toFixed(4)} USDC</p>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          value={payAmount}
                          onChange={e => setPayAmount(e.target.value)}
                          placeholder="0.00"
                          type="number"
                          inputMode="decimal"
                          className="bp-input w-full bg-transparent text-2xl font-bold outline-none tabular-nums"
                          style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}
                        />
                        {payAmount && parseFloat(payAmount) > 0 && (
                          <p className="text-xs mt-1" style={{ color:textMuted }}>{toInr(payAmount)}</p>
                        )}
                      </>
                    )}
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
                <div className="mb-4" style={innerStyle}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Note (optional)</label>
                    <input
                      value={payNote}
                      onChange={e => setPayNote(e.target.value)}
                      placeholder="Groceries, chai, rent…"
                      className="w-full bg-transparent text-sm outline-none"
                      style={{ color:textMain }}
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

                {/* Gas estimate */}
                {gasEst && isAddress(payTo) && payAmount && (
                  <div className="flex items-center gap-1.5 mb-3 px-1">
                    <Zap size={12} style={{ color:'#10b981' }} />
                    <span className="text-xs" style={{ color:textMuted }}>Network fee: <span style={{ color:'#10b981', fontWeight:600 }}>{gasEst}</span> · Near-instant on Arc</span>
                  </div>
                )}

                {/* Pay button */}
                <button
                  onClick={() => void handlePay()}
                  disabled={!isConnected || !onArc || !isAddress(payTo) || !payAmount || payStep === 'sending'}
                  className="bp-pay-btn flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white disabled:opacity-50"
                  style={{ minHeight:56 }}>
                  {payStep === 'sending'
                    ? <><Loader2 size={18} className="animate-spin" /> Sending…</>
                    : <><Send size={18} /> Pay {payAmount ? `$${payAmount}` : ''} USDC</>}
                </button>
                {/* Hint under pay button */}
                {isConnected && onArc && (!isAddress(payTo) || !payAmount) && (
                  <p className="text-center text-xs mt-2" style={{ color:textMuted }}>
                    {!payTo ? 'Enter a recipient address or scan their QR code' : !isAddress(payTo) ? 'Enter a valid wallet address (0x…)' : 'Enter an amount to continue'}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* RECEIVE TAB */}
        {tab === 'receive' && (
          <div className="rounded-2xl p-5 text-center" style={cardStyle}>
            <h2 className="font-bold text-base mb-4" style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}>Receive USDC</h2>

            {address ? (
              <>
                {/* Shop name input */}
                <div className="mb-4 text-left" style={innerStyle}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Shop / Your Name (optional)</label>
                    <input
                      value={shopName}
                      onChange={e => { setShopName(e.target.value); localStorage.setItem('bachat_shopName', e.target.value) }}
                      placeholder="e.g. Sharma Kirana Store"
                      className="w-full bg-transparent text-base font-bold outline-none"
                      style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}
                      maxLength={40}
                    />
                  </div>
                </div>

                {/* Merchant QR card */}
                <div ref={qrCardRef} className="mx-auto mb-3 rounded-3xl overflow-hidden inline-block" style={{
                  background: 'linear-gradient(135deg,#1e3a8a 0%,#4c1d95 100%)',
                  padding: '20px 24px 16px',
                  boxShadow: '0 8px 32px rgba(30,58,138,0.35)',
                  minWidth: 240,
                }}>
                  {shopName && (
                    <div style={{
                      fontFamily: 'Space Grotesk, sans-serif',
                      fontWeight: 800,
                      fontSize: shopName.length > 20 ? 18 : 22,
                      letterSpacing: '-0.03em',
                      background: 'linear-gradient(90deg,#93c5fd,#c4b5fd,#f9a8d4)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      marginBottom: 12,
                      lineHeight: 1.2,
                    }}>
                      {shopName}
                    </div>
                  )}
                  <div className="rounded-2xl p-3 inline-block" style={{ background: 'white' }}>
                    <QRCodeSVG value={shareLink || `https://arc-studio-7630b92000bb479e8ada5b05.vercel.app/?to=${address}`} size={180} />
                  </div>
                  <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'Space Grotesk,sans-serif' }}>
                    Scan to pay USDC on Arc
                  </div>
                  {receiveAmount && (
                    <div style={{ marginTop: 4, color: 'white', fontSize: 15, fontWeight: 700, fontFamily: 'Space Grotesk,sans-serif' }}>
                      ₹{(parseFloat(receiveAmount) * inrRate).toFixed(0)} · ${receiveAmount} USDC
                    </div>
                  )}
                </div>

                {/* Accepted networks */}
                <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
                  <span className="text-xs font-semibold" style={{ color:textMuted }}>Accepts USDC on:</span>
                  {[
                    { name: 'Arc', color: '#3b82f6' },
                    { name: 'Base', color: '#0052ff' },
                    { name: 'Ethereum', color: '#627eea' },
                    { name: 'Arbitrum', color: '#28a0f0' },
                    { name: 'Optimism', color: '#ff0420' },
                    { name: 'Polygon', color: '#8247e5' },
                  ].map(n => (
                    <span key={n.name} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: n.color + '18', color: n.color, border: `1px solid ${n.color}33` }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: n.color, display: 'inline-block' }} />
                      {n.name}
                    </span>
                  ))}
                </div>

                <p className="text-xs font-mono mb-4 px-2 break-all" style={{ color:textMuted }}>{address}</p>

                {/* Request amount */}
                <div className="mb-4 text-left" style={innerStyle}>
                  <div className="rounded-xl p-3">
                    <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Request amount (optional)</label>
                    <input
                      value={receiveAmount}
                      onChange={e => setReceiveAmount(e.target.value)}
                      placeholder="0.00"
                      type="number"
                      inputMode="decimal"
                      className="w-full bg-transparent text-xl font-bold outline-none tabular-nums"
                      style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}
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

                <div className="grid grid-cols-3 gap-2 mb-2">
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
                {/* Download + Print */}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleDownloadQR}
                    className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
                    style={{ background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', color:'white' }}>
                    <ExternalLink size={16} /> Download PNG
                  </button>
                  <button onClick={handlePrintQR}
                    className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold"
                    style={{ background:'rgba(59,130,246,0.1)', color:'#1d4ed8', border:'1.5px solid rgba(59,130,246,0.3)' }}>
                    🖨️ Print
                  </button>
                </div>
              </>
            ) : (
              <div className="py-12 flex flex-col items-center gap-4">
                <div className="flex size-16 items-center justify-center rounded-full" style={{ background:'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}>
                  <QrCode size={28} color="white" />
                </div>
                <div>
                  <p className="text-base font-semibold mb-1" style={{ color:textMain }}>Your payment QR</p>
                  <p className="text-sm" style={{ color:textMuted }}>Connect your wallet to generate your QR code</p>
                </div>
                <ConnectKitButton />
              </div>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div className="rounded-2xl p-4" style={cardStyle}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-base" style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}>Transaction History</h2>
              {historyLoading && <Loader2 size={14} className="animate-spin" style={{ color:textMuted }} />}
              {!historyLoading && onchainHistory.length > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:'rgba(16,185,129,0.12)', color:'#059669' }}>Live from Arc</span>
              )}
            </div>
            {!address ? (
              <p className="text-sm text-center py-8" style={{ color:textMuted }}>Connect wallet to see your transactions</p>
            ) : mergedHistory.length === 0 && !historyLoading ? (
              <p className="text-sm text-center py-8" style={{ color:textMuted }}>No transactions yet — send your first USDC!</p>
            ) : (
              <div className="space-y-2">
                {mergedHistory.map(h => (
                  <a key={h.hash} href={`${EXPLORER}/tx/${h.hash}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition active:scale-95"
                    style={{ background: dk ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)' }}>
                    <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-full"
                      style={{ background: h.dir === 'out' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: h.dir === 'out' ? '#dc2626' : '#059669' }}>
                      {h.dir === 'out' ? <Send size={16} /> : <ArrowDownLeft size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color:textMain }}>
                        {h.dir === 'out' ? `To ${shortAddr(h.to)}` : `From ${shortAddr(h.to)}`}
                      </p>
                      <p className="text-xs truncate" style={{ color:textMuted }}>
                        {h.note || 'USDC transfer'} · {fmtDate(h.ts)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-sm font-bold block" style={{ color: h.dir === 'out' ? '#dc2626' : '#059669' }}>
                        {h.dir === 'out' ? '-' : '+'}${h.amount}
                      </span>
                      <span className="text-xs" style={{ color:textMuted }}>{toInr(h.amount)}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── VAULT TAB ── */}
        {tab === 'vault' && <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-500" size={32} /></div>}><VaultTab toInr={toInr} /></Suspense>}

        {/* ── CHIT FUND TAB ── */}
        {tab === 'chit' && <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-500" size={32} /></div>}><ChitFundTab toInr={toInr} /></Suspense>}

      </main>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 inset-x-0 z-20 pb-safe-bottom" style={{ ...cardStyle, borderTop: dk ? '1px solid rgba(255,255,255,0.08)' : undefined }}>
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
              style={{ color: tab === id ? '#3b82f6' : (dk ? '#4a6080' : '#9ca3af'), minHeight: 60 }}>
              {icon}
              <span className="text-xs font-semibold">{label}</span>
              {tab === id && <div className="bp-nav-dot h-0.5 w-6 rounded-full mt-0.5" style={{ background:'linear-gradient(90deg,#3b82f6,#8b5cf6)' }} />}
            </button>
          ))}
        </div>
      </nav>

      {/* ── SPLIT BILL SHEET ── */}
      {showSplit && (
        <div className="fixed inset-0 z-30 flex items-end" style={{ background:'rgba(0,0,0,0.4)' }} onClick={() => setShowSplit(false)}>
          <div className="w-full rounded-t-3xl p-6" style={{ ...cardStyle, maxWidth:448, margin:'0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="mb-1 h-1 w-10 rounded-full mx-auto" style={{ background: dk ? 'rgba(255,255,255,0.2)' : '#d1d5db' }} />
            <h3 className="font-bold text-base mb-4 mt-2" style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}>Split Bill</h3>

            <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Total amount ($)</label>
            <input value={splitTotal} onChange={e => setSplitTotal(e.target.value)}
              placeholder="0.00" type="number" inputMode="decimal"
              className="w-full rounded-xl p-3 mb-3 text-xl font-bold outline-none tabular-nums"
              style={{ ...innerStyle, color:textMain, fontFamily:'Space Grotesk,sans-serif' }} />

            <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Number of people</label>
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
                <p className="text-xs" style={{ color:textMuted }}>Each person pays</p>
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
          <div className="w-full rounded-t-3xl p-6" style={{ ...cardStyle, maxWidth:448, margin:'0 auto' }} onClick={e => e.stopPropagation()}>
            <div className="mb-1 h-1 w-10 rounded-full mx-auto" style={{ background: dk ? 'rgba(255,255,255,0.2)' : '#d1d5db' }} />
            <h3 className="font-bold text-base mb-1 mt-2" style={{ color:textMain, fontFamily:'Space Grotesk,sans-serif' }}>Bridge USDC to Arc</h3>
            <p className="text-xs mb-4" style={{ color:textMuted }}>Move USDC from another chain to Arc for near-zero fees</p>

            <label className="text-xs font-semibold mb-2 block" style={{ color:textMuted }}>From chain</label>
            <div className="flex gap-2 mb-4 flex-wrap">
              {BRIDGE_CHAINS.map(b => (
                <button key={b.label} onClick={() => setBridgeFrom(b)}
                  className="rounded-xl px-3 py-2 text-xs font-bold transition"
                  style={bridgeFrom.label === b.label ? { background:'#1d4ed8', color:'white' } : { background:'rgba(59,130,246,0.1)', color:'#1d4ed8' }}>
                  {b.label}
                </button>
              ))}
            </div>

            <label className="text-xs font-semibold mb-1 block" style={{ color:textMuted }}>Amount (USDC)</label>
            <input value={bridgeAmount} onChange={e => setBridgeAmount(e.target.value)}
              placeholder="0.00" type="number" inputMode="decimal"
              className="w-full rounded-xl p-3 mb-4 text-xl font-bold outline-none tabular-nums"
              style={{ ...innerStyle, color:textMain, fontFamily:'Space Grotesk,sans-serif' }} />

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
