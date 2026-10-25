/**
 * BachatPay — Trustless Pay-Per-Call API Gateway on Arc
 * Built with Arc Studio — https://studio.arc.io
 *
 * Any wallet can pay a small USDC amount to register an onchain API call.
 * The contract emits a CallPaid event that any service can listen to and fulfil.
 */

import { useState, useCallback, useEffect } from 'react'
import { ConnectKitButton } from 'connectkit'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { erc20Abi, parseUnits, formatUnits } from 'viem'
import { toast } from 'sonner'
import {
  Zap, ExternalLink, ArrowRight, Shield, Cpu, Activity,
  Loader2, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { NANOPAY_TESTNET } from './nanopay-contract'

// ── Arc Testnet constants (chain ID 5042002) ──────────────────────────────────
// USDC on Arc Testnet: ERC-20 at 6 decimals
const TARGET_CHAIN_ID = NANOPAY_TESTNET.chainId
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const EXPLORER_BASE = 'https://explorer.testnet.arc.io'

const PRICE_DISPLAY = '0.10'
const PRICE_RAW = parseUnits(PRICE_DISPLAY, USDC_DECIMALS)

// ── helpers ───────────────────────────────────────────────────────────────────

const shortenAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`
const formatUsdc = (raw: bigint) => Number(formatUnits(raw, USDC_DECIMALS)).toFixed(2)
const explorerTx = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`
const explorerAddr = (addr: string) => `${EXPLORER_BASE}/address/${addr}`

// ── glass surface styles ──────────────────────────────────────────────────────

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.10)',
    borderRadius: '24px',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(18,45,69,0.08)',
    borderRadius: '16px',
  } as React.CSSProperties,
}

// ── main component ────────────────────────────────────────────────────────────

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== TARGET_CHAIN_ID

  const [requestData, setRequestData] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'paying' | 'done'>('idle')

  // ── contract reads ─────────────────────────────────────────────────────────

  const { data: totalCalls, refetch: refetchTotal } = useReadContract({
    address: NANOPAY_TESTNET.address,
    abi: NANOPAY_TESTNET.abi,
    functionName: 'totalCalls',
    chainId: TARGET_CHAIN_ID,
  })

  const { data: myCallCount, refetch: refetchMyCalls } = useReadContract({
    address: NANOPAY_TESTNET.address,
    abi: NANOPAY_TESTNET.abi,
    functionName: 'callCount',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { data: contractBalance, refetch: refetchBalance } = useReadContract({
    address: NANOPAY_TESTNET.address,
    abi: NANOPAY_TESTNET.abi,
    functionName: 'getBalance',
    chainId: TARGET_CHAIN_ID,
  })

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address },
  })

  // ── approve tx ─────────────────────────────────────────────────────────────

  const {
    writeContract: approve,
    data: approveTxHash,
    isPending: approveIsPending,
  } = useWriteContract()

  const { isLoading: approveIsConfirming, isSuccess: approveIsSuccess } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  // ── pay tx ─────────────────────────────────────────────────────────────────

  const {
    writeContract: pay,
    data: payTxHash,
    isPending: payIsPending,
  } = useWriteContract()

  const { isLoading: payIsConfirming, isSuccess: payIsSuccess } =
    useWaitForTransactionReceipt({ hash: payTxHash })

  // ── handlers ───────────────────────────────────────────────────────────────

  const handlePay = useCallback(() => {
    if (!requestData.trim()) {
      toast.error('Enter a request description first')
      return
    }
    setStep('paying')
    pay(
      {
        address: NANOPAY_TESTNET.address,
        abi: NANOPAY_TESTNET.abi,
        functionName: 'pay',
        args: [requestData.trim()],
        chainId: TARGET_CHAIN_ID,
      },
      {
        onSuccess: () => {
          toast.success('Call registered onchain!')
          setRequestData('')
          setStep('done')
          void refetchTotal()
          void refetchMyCalls()
          void refetchBalance()
        },
        onError: (err) => {
          const msg = err.message?.toLowerCase() ?? ''
          if (!msg.includes('user rejected')) toast.error('Payment failed — check USDC allowance')
          setStep('idle')
        },
      },
    )
  }, [requestData, pay, refetchTotal, refetchMyCalls, refetchBalance])

  const handleApprove = useCallback(() => {
    if (!address) return
    setStep('approving')
    approve(
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [NANOPAY_TESTNET.address, PRICE_RAW],
        chainId: TARGET_CHAIN_ID,
      },
      {
        onSuccess: () => { toast.success('Allowance approved') },
        onError: (err) => {
          const msg = err.message?.toLowerCase() ?? ''
          if (!msg.includes('user rejected')) toast.error('Approval failed')
          setStep('idle')
        },
      },
    )
  }, [address, approve])

  // Auto-advance: once approval confirms, trigger pay
  useEffect(() => {
    if (!approveIsSuccess || step !== 'approving') return
    const id = setTimeout(() => { handlePay() }, 0)
    return () => { clearTimeout(id) }
  }, [approveIsSuccess, step, handlePay])

  // ── derived ────────────────────────────────────────────────────────────────

  const isBusy = approveIsPending || approveIsConfirming || payIsPending || payIsConfirming
  const canPay = isConnected && !wrongChain && !!requestData.trim() && !isBusy

  const handleCta = () => {
    if (!isConnected) return
    if (wrongChain) { switchChain({ chainId: TARGET_CHAIN_ID }); return }
    handleApprove()
  }

  const handleReset = () => { setStep('idle') }

  // ── CTA label ──────────────────────────────────────────────────────────────

  const ctaLabel = () => {
    if (!isConnected) return 'Connect Wallet'
    if (wrongChain) return 'Switch to Arc Testnet'
    if (approveIsPending) return (
      <span className="flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Confirm approval in wallet…
      </span>
    )
    if (approveIsConfirming) return (
      <span className="flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Confirming approval…
      </span>
    )
    if (payIsPending) return (
      <span className="flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Confirm payment in wallet…
      </span>
    )
    if (payIsConfirming) return (
      <span className="flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Registering call onchain…
      </span>
    )
    return (
      <span className="flex items-center justify-center gap-2">
        Pay ${PRICE_DISPLAY} USDC <ArrowRight className="size-4" />
      </span>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-dvh flex flex-col items-center px-4 py-8">

      {/* Header */}
      <header className="w-full max-w-md flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <div
            className="flex size-8 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent)' }}
          >
            <Zap className="size-4 text-white" />
          </div>
          <span className="display text-lg" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            BachatPay
          </span>
        </div>
        <ConnectKitButton />
      </header>

      {/* Hero — live stats */}
      <section className="w-full max-w-md mb-4" style={glass.card}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex size-5 items-center justify-center rounded-md"
              style={{ background: 'rgba(26,128,71,0.12)' }}
            >
              <Activity className="size-3" style={{ color: 'var(--success)' }} />
            </div>
            <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--muted)' }}>
              Total API Calls
            </span>
          </div>

          <div className="flex items-baseline gap-2 mb-1">
            <span className="display text-5xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {totalCalls != null ? String(totalCalls as bigint) : '—'}
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>
              calls registered
            </span>
          </div>

          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            Live · {shortenAddress(NANOPAY_TESTNET.address)}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 divide-x border-t" style={{ borderColor: 'var(--border)' }}>
          {[
            { label: 'Price / call', value: `$${PRICE_DISPLAY}`, sub: 'USDC' },
            { label: 'Your calls', value: myCallCount != null ? String(myCallCount as bigint) : '—', sub: 'total' },
            { label: 'Gateway USDC', value: contractBalance != null ? `$${formatUsdc(contractBalance as bigint)}` : '—', sub: 'earned' },
          ].map((s) => (
            <div key={s.label} className="py-4 px-3 text-center">
              <div className="display text-xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {s.value}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pay card */}
      <section className="w-full max-w-md mb-4" style={glass.card}>
        <div className="p-6">
          <h2 className="display text-lg mb-1" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            Register a Bachat Call
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
            Pay ${PRICE_DISPLAY} USDC to record your request onchain. Any service listening to{' '}
            <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>CallPaid</span> events can fulfil it.
          </p>

          {step === 'done' && payIsSuccess ? (
            /* Receipt */
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="size-10" style={{ color: 'var(--success)' }} />
              <p className="display text-lg font-bold text-center" style={{ color: 'var(--ink)' }}>
                Call registered!
              </p>
              {payTxHash && (
                <a
                  href={explorerTx(payTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--accent-hover)' }}
                >
                  View on ArcScan <ExternalLink className="size-3" />
                </a>
              )}
              <button
                onClick={handleReset}
                className="mt-2 text-sm font-semibold"
                style={{ color: 'var(--muted)' }}
              >
                Make another call
              </button>
            </div>
          ) : (
            <>
              {/* Request input */}
              <div className="mb-4" style={glass.inner}>
                <div className="p-4">
                  <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--muted)' }}>
                    Request description
                  </label>
                  <textarea
                    value={requestData}
                    onChange={(e) => { setRequestData(e.target.value) }}
                    placeholder={`e.g. "Get current BTC/USD price" or "Summarise this article: https://..."`}
                    rows={3}
                    className="w-full bg-transparent text-sm outline-none resize-none placeholder:opacity-40"
                    style={{ color: 'var(--ink)', fontFamily: "'DM Sans', sans-serif" }}
                    disabled={isBusy}
                  />
                </div>
                <div className="px-4 pb-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TokenUSDC variant="branded" size={16} />
                    <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
                      ${PRICE_DISPLAY} USDC per call
                    </span>
                  </div>
                  {isConnected && usdcBalance != null && (
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                      Balance: ${formatUsdc(usdcBalance)}
                    </span>
                  )}
                </div>
              </div>

              {/* Two-step progress indicator */}
              {isBusy && (
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: approveIsSuccess ? 'var(--success)' : 'var(--accent)' }}
                  >
                    {approveIsSuccess ? <CheckCircle2 className="size-3.5" /> : '1'}
                  </div>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Approve allowance</span>
                  <ChevronRight className="size-3 ml-auto" style={{ color: 'var(--subtle)' }} />
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      background: step === 'paying' ? 'var(--accent)' : 'var(--border)',
                      color: step === 'paying' ? 'white' : 'var(--subtle)',
                    }}
                  >
                    2
                  </div>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Send payment</span>
                </div>
              )}

              {/* CTA */}
              <button
                disabled={!canPay && isConnected && !wrongChain}
                onClick={handleCta}
                className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {ctaLabel()}
              </button>
            </>
          )}
        </div>
      </section>

      {/* How it works */}
      <section className="w-full max-w-md mb-8" style={glass.card}>
        <div className="p-6">
          <h3 className="display text-base font-bold mb-4" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            How it works
          </h3>
          <div className="flex flex-col gap-3">
            {[
              {
                icon: <Shield className="size-4" />,
                title: 'Trustless',
                desc: 'Payment and request are atomic — one onchain transaction records both.',
              },
              {
                icon: <Cpu className="size-4" />,
                title: 'Agent-ready',
                desc: 'AI agents or services listen to CallPaid events and fulfil requests automatically.',
              },
              {
                icon: <Zap className="size-4" />,
                title: 'Sub-cent fees',
                desc: 'Arc uses USDC as native gas — micropayments are economically viable.',
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
                >
                  {item.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{item.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-md flex items-center justify-between text-xs pb-20" style={{ color: 'var(--subtle)' }}>
        <a
          href={explorerAddr(NANOPAY_TESTNET.address)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--accent-hover)' }}
        >
          View contract <ExternalLink className="size-3" />
        </a>
        <span>BachatPay · Arc Testnet</span>
      </footer>
    </div>
  )
}
