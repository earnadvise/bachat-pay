/**
 * ChitFund — Onchain ROSCA/Committee Savings tab
 * Built with Arc Studio — https://studio.arc.io
 * Designed for simplicity — works for first-time users and village communities
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits, formatUnits, isAddress, encodeFunctionData, decodeFunctionResult } from 'viem'
import { toast } from 'sonner'
import { Users, Loader2, ExternalLink, CheckCircle2, Gift, ArrowLeft, Copy } from 'lucide-react'
import { CONTRACTS, CHIT_FUND_ABI } from './contracts'

const ARC_CHAIN_ID = 5042
const USDC_MAINNET = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const FUND_ADDR = CONTRACTS.chitFund.mainnet
const EXPLORER = 'https://explorer.arc.io'

const fmt = (raw: bigint) => parseFloat(formatUnits(raw, USDC_DECIMALS)).toFixed(2)

interface FundInfo {
  id: number
  name: string
  contributionAmount: bigint
  currentRound: bigint
  totalRounds: bigint
  active: boolean
  members: string[]
  roundDeadline: bigint
  roundDuration: bigint
  admin: string
}

interface Props { toInr: (u: string | number) => string; darkMode?: boolean; resolveLabel?: (addr: string) => string }

export default function ChitFundTab({ toInr, darkMode, resolveLabel: resolveLabelProp }: Props) {
  const resolveLabel = resolveLabelProp ?? ((a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`)
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<'home' | 'create' | 'join' | 'detail'>('home')
  const [fundName, setFundName] = useState('')
  const [contribution, setContribution] = useState('')
  const [members, setMembers] = useState('')
  const [roundDays, setRoundDays] = useState('7')
  const [fundIdInput, setFundIdInput] = useState('')
  const [selectedFund, setSelectedFund] = useState<FundInfo | null>(null)
  const [myFunds, setMyFundsState] = useState<FundInfo[]>([])
  const [loadingFunds, setLoadingFunds] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [pendingAction, setPendingAction] = useState('')
  const pendingContributeRef = useRef<{ fundId: number; amount: string } | null>(null)
  const [newFundId, setNewFundId] = useState<number | null>(null)

  const card = darkMode
    ? { background: 'rgba(30,41,59,0.9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 20 } as React.CSSProperties
    : { background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 20, padding: 20, boxShadow: '0 4px 24px rgba(18,45,69,0.07)' } as React.CSSProperties
  const textMain = darkMode ? '#f1f5f9' : '#0f1c35'
  const textMuted = darkMode ? '#94a3b8' : '#6b7c99'

  const { writeContractAsync } = useWriteContract()
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash, chainId: ARC_CHAIN_ID })
  const confirmedRef = useRef(false)

  // Read total funds count
  const { data: totalFunds, refetch: refetchTotal } = useReadContract({
    address: FUND_ADDR,
    abi: CHIT_FUND_ABI,
    functionName: 'totalFunds',
    chainId: ARC_CHAIN_ID,
  })

  // Pending claim
  const { data: pendingClaim, refetch: refetchClaim } = useReadContract({
    address: FUND_ADDR,
    abi: CHIT_FUND_ABI,
    functionName: 'pendingClaims',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  })

  // Load user's funds by scanning all fund IDs via RPC batch
  const loadMyFunds = useCallback(async () => {
    if (!address || totalFunds === undefined) return
    setLoadingFunds(true)
    const total = Number(totalFunds)
    const found: FundInfo[] = []
    const start = Math.max(0, total - 100)
    // Batch all calls in one JSON-RPC batch request
    const batch = Array.from({ length: total - start }, (_, idx) => ({
      jsonrpc: '2.0',
      id: start + idx,
      method: 'eth_call',
      params: [{
        to: FUND_ADDR,
        data: encodeFunctionData({ abi: CHIT_FUND_ABI, functionName: 'getFund', args: [BigInt(start + idx)] })
      }, 'latest']
    }))
    try {
      const resp = await fetch('https://rpc.mainnet.arc.io', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch)
      })
      const results: { id: number; result?: string; error?: unknown }[] = await resp.json() as { id: number; result?: string; error?: unknown }[]
      for (const r of results) {
        if (!r.result || r.result === '0x') continue
        try {
          const decoded = decodeFunctionResult({ abi: CHIT_FUND_ABI, functionName: 'getFund', data: r.result as `0x${string}` }) as {
            admin: string; name: string; contributionAmount: bigint; currentRound: bigint;
            totalRounds: bigint; active: boolean; members: string[]; roundDeadline: bigint; roundDuration: bigint
          }
          const isMember = decoded.members.some(m => m.toLowerCase() === address.toLowerCase())
          if (isMember) {
            found.push({ id: r.id, ...decoded })
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* network error */ }
    // Update state — replace internal setter
    setLoadingFunds(false)
    setMyFundsState(found)
  }, [address, totalFunds])

  useEffect(() => {
    if (!address || totalFunds === undefined) return
    void loadMyFunds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, String(totalFunds)])

  useEffect(() => {
    if (!txConfirmed || !txHash || confirmedRef.current) return
    confirmedRef.current = true

    // If approve just confirmed and we have a pending contribute, fire it
    if (pendingAction === 'approve' && pendingContributeRef.current) {
      const { fundId } = pendingContributeRef.current
      pendingContributeRef.current = null
      queueMicrotask(async () => {
        try {
          setPendingAction('contribute')
          setTxHash(undefined)
          confirmedRef.current = false
          const h = await writeContractAsync({
            address: FUND_ADDR,
            abi: CHIT_FUND_ABI,
            functionName: 'contribute',
            args: [BigInt(fundId)],
            chainId: ARC_CHAIN_ID,
          })
          setTxHash(h)
          toast('Step 2/2: Contributing to fund…')
        } catch (e) {
          toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
          setPendingAction('')
        }
      })
      return
    }

    const wasCreate = pendingAction === 'create'
    toast.success('Done! Transaction confirmed.')
    queueMicrotask(async () => {
      setPendingAction('')
      setTxHash(undefined)
      setView('home')
      setFundName(''); setContribution(''); setMembers(''); setFundIdInput('')
      const result = await refetchTotal()
      if (wasCreate && result.data !== undefined) {
        // new fund ID = totalFunds - 1 (0-indexed)
        setNewFundId(Number(result.data) - 1)
      }
      confirmedRef.current = false
      void refetchTotal()
      void refetchClaim()
    })
  }, [txConfirmed, txHash, pendingAction, writeContractAsync, refetchTotal, refetchClaim])

  const handleCreate = useCallback(async () => {
    if (!fundName || !contribution || !address) return
    // Always include creator's own wallet, then add others
    const otherList = members.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).filter(m => m.toLowerCase() !== address.toLowerCase())
    const memberList = [address, ...otherList]
    if (memberList.length < 2) { toast.error('Add at least one other member wallet address'); return }
    if (memberList.length > 20) { toast.error('Maximum 20 members allowed'); return }
    if (memberList.some(m => !isAddress(m))) { toast.error('One of the addresses looks wrong — check and try again'); return }
    try {
      setPendingAction('create')
      const hash = await writeContractAsync({
        address: FUND_ADDR,
        abi: CHIT_FUND_ABI,
        functionName: 'createFund',
        args: [fundName, parseUnits(contribution, USDC_DECIMALS), memberList as `0x${string}`[], BigInt(Number(roundDays) * 86400)],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Creating your committee…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [fundName, contribution, members, roundDays, address, writeContractAsync])

  const handleContribute = useCallback(async (fundId: number, amount: string) => {
    try {
      setPendingAction('approve')
      pendingContributeRef.current = { fundId, amount }
      const hash = await writeContractAsync({
        address: USDC_MAINNET,
        abi: erc20Abi,
        functionName: 'approve',
        args: [FUND_ADDR, parseUnits(amount, USDC_DECIMALS)],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Step 1/2: Approving USDC…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
      pendingContributeRef.current = null
    }
  }, [writeContractAsync])

  const handleClaim = useCallback(async () => {
    try {
      setPendingAction('claim')
      const hash = await writeContractAsync({
        address: FUND_ADDR,
        abi: CHIT_FUND_ABI,
        functionName: 'claim',
        args: [],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Claiming your funds…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [writeContractAsync])

  const claimAmt = pendingClaim ? fmt(pendingClaim) : '0'
  const memberCount = members.split(/[\n,]+/).filter(s => s.trim()).length

  // --- HOME VIEW ---
  if (view === 'home') return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">

      {/* Header */}
      <div className="text-center py-2">
        <div className="text-4xl mb-1">🤝</div>
        <h2 className="text-xl font-bold" style={{ color: textMain }}>Committee / Chit Fund</h2>
        <p className="text-sm mt-1" style={{ color: textMuted }}>Group savings — everyone pays, one person gets the full amount each round</p>
      </div>

      {/* New fund created banner */}
      {newFundId !== null && (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
          <div className="text-2xl mb-1">🎉</div>
          <p className="text-white font-bold text-lg">Committee Created!</p>
          <p className="text-purple-200 text-sm mb-1">Share this ID with all members</p>
          <div className="flex items-center justify-center gap-2 my-2">
            <span className="text-white font-black text-4xl">{newFundId}</span>
          </div>
          <button
            onClick={() => { void navigator.clipboard.writeText(String(newFundId)); toast.success('Committee ID copied!') }}
            className="px-6 py-2 rounded-xl font-bold text-purple-700 bg-white text-sm flex items-center gap-2 mx-auto mb-2"
          >
            <Copy size={14} /> Copy Committee ID
          </button>
          <p className="text-purple-200 text-xs">Tell everyone: "Our Committee ID is {newFundId} — download BachatPay and pay your round"</p>
          <button onClick={() => setNewFundId(null)} className="mt-2 text-purple-300 text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Claim banner */}
      {parseFloat(claimAmt) > 0 && (
        <div className="rounded-2xl p-4 text-center" style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
          <div className="text-2xl mb-1">🎉</div>
          <p className="text-white font-bold text-lg">Your turn to receive!</p>
          <p className="text-green-100 text-sm mb-3">${claimAmt} USDC — {toInr(claimAmt)}</p>
          <button
            onClick={() => void handleClaim()}
            disabled={pendingAction === 'claim'}
            className="px-8 py-3 rounded-xl font-bold text-green-700 bg-white text-base flex items-center gap-2 mx-auto"
          >
            {pendingAction === 'claim' ? <Loader2 size={18} className="animate-spin" /> : <Gift size={18} />}
            Collect Money
          </button>
        </div>
      )}

      {/* My Funds */}
      {loadingFunds && (
        <div className="text-center py-4">
          <Loader2 size={20} className="animate-spin mx-auto" style={{ color: '#7c3aed' }} />
          <p className="text-sm mt-2" style={{ color: textMuted }}>Loading your committees…</p>
        </div>
      )}

      {!loadingFunds && address && myFunds.length === 0 && (
        <div className="rounded-2xl p-4 text-center" style={{ background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(124,58,237,0.04)', border: '1px dashed rgba(124,58,237,0.3)' }}>
          <p className="text-2xl mb-1">🔍</p>
          <p className="text-sm font-medium" style={{ color: textMuted }}>No committees found for your wallet yet.</p>
          <p className="text-xs mt-1" style={{ color: textMuted }}>Start a new one or ask your organizer for the Committee ID.</p>
        </div>
      )}

      {myFunds.length > 0 && (
        <div style={card}>
          <h3 className="font-bold mb-3" style={{ color: textMain }}>Your Committees</h3>
          {myFunds.map(f => (
            <div key={f.id} className="rounded-xl mb-2 overflow-hidden" style={{ border: '1px solid rgba(124,58,237,0.2)' }}>
              <button
                onClick={() => { setSelectedFund(f); setView('detail') }}
                className="w-full text-left p-3 flex items-center justify-between"
                style={{ background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(124,58,237,0.04)' }}
              >
                <div>
                  <p className="font-semibold text-sm" style={{ color: textMain }}>{f.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: textMuted }}>
                    {f.members.length} members · Round {Number(f.currentRound) + 1}/{Number(f.totalRounds)} · ID: <span className="font-bold" style={{ color: '#7c3aed' }}>{f.id}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: '#7c3aed' }}>${fmt(f.contributionAmount)}</p>
                  <p className="text-xs" style={{ color: textMuted }}>per round</p>
                </div>
              </button>
              <button
                onClick={() => { setFundIdInput(String(f.id)); setContribution(formatUnits(f.contributionAmount, USDC_DECIMALS)); setView('join') }}
                className="w-full py-2 text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
              >
                💸 Pay My Round (${fmt(f.contributionAmount)})
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setView('create')}
          className="rounded-2xl p-5 text-center flex flex-col items-center gap-2"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }}
        >
          <span className="text-3xl">➕</span>
          <span className="font-bold text-base">Start New</span>
          <span className="text-xs text-purple-200">Create a committee</span>
        </button>
        <button
          onClick={() => setView('join')}
          className="rounded-2xl p-5 text-center flex flex-col items-center gap-2"
          style={card}
        >
          <span className="text-3xl">🤝</span>
          <span className="font-bold text-base" style={{ color: textMain }}>Pay My Round</span>
          <span className="text-xs" style={{ color: textMuted }}>Contribute to a fund</span>
        </button>
      </div>

      {/* How it works — simple */}
      <div style={card}>
        <h3 className="font-bold mb-3 text-center" style={{ color: textMain }}>How it works</h3>
        <div className="space-y-3">
          {[
            { emoji: '👥', title: '5 friends join', desc: 'Each agrees to pay $20 USDC every month' },
            { emoji: '💰', title: 'Pool = $100', desc: 'All 5 payments collected = $100 total' },
            { emoji: '🔄', title: 'One person gets $100', desc: 'Round 1 to friend A, Round 2 to friend B…' },
            { emoji: '✅', title: 'All 5 get a turn', desc: 'After 5 months, everyone has received once' },
          ].map(s => (
            <div key={s.title} className="flex items-start gap-3">
              <span className="text-2xl">{s.emoji}</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: textMain }}>{s.title}</p>
                <p className="text-xs" style={{ color: textMuted }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {txHash && (
        <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 text-xs justify-center py-2" style={{ color: '#7c3aed' }}>
          <ExternalLink size={12} /> <CheckCircle2 size={12} /> View on explorer
        </a>
      )}
    </div>
  )

  // --- CREATE VIEW ---
  if (view === 'create') return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <button onClick={() => setView('home')} className="flex items-center gap-2 text-sm font-medium" style={{ color: '#7c3aed' }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="text-center py-2">
        <div className="text-4xl mb-1">➕</div>
        <h2 className="text-xl font-bold" style={{ color: textMain }}>Start a Committee</h2>
        <p className="text-sm mt-1" style={{ color: textMuted }}>Fill in the details below</p>
      </div>

      <div style={card} className="space-y-4">
        {/* Name */}
        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Committee Name</label>
          <input
            className="w-full rounded-xl px-4 py-3 text-base outline-none"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            placeholder="e.g. Friends Committee, Ghar Ki Bachat"
            value={fundName}
            onChange={e => setFundName(e.target.value)}
          />
        </div>

        {/* Contribution */}
        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Each person pays (USDC per round)</label>
          <input
            className="w-full rounded-xl px-4 py-3 text-base outline-none"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            placeholder="e.g. 10"
            type="number"
            value={contribution}
            onChange={e => setContribution(e.target.value)}
          />
          {contribution && (
            <p className="text-sm mt-1 font-medium" style={{ color: '#16a34a' }}>
              = {toInr(contribution)} per person · Total pool = {toInr(String(parseFloat(contribution) * memberCount))}
            </p>
          )}
        </div>

        {/* Members */}
        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Other Members' Wallet Addresses</label>
          <div className="rounded-xl px-3 py-2 mb-2 text-xs font-medium" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
            ✅ Your wallet is automatically added as Member 1
          </div>
          <p className="text-xs mb-2" style={{ color: textMuted }}>Add your friends' wallet addresses below. One per line. (Need at least 1 other person)</p>
          <textarea
            className="w-full rounded-xl px-4 py-3 text-xs outline-none resize-none font-mono"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            rows={4}
            placeholder={'0xFriend1Address\n0xFriend2Address\n0xFriend3Address'}
            value={members}
            onChange={e => setMembers(e.target.value)}
          />
          {memberCount >= 1 && <p className="text-xs mt-1 font-medium" style={{ color: '#7c3aed' }}>{memberCount + 1} total members (you + {memberCount})</p>}
        </div>

        {/* Round duration */}
        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>How often to collect? (days)</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setRoundDays(String(d))}
                className="py-2 rounded-xl text-sm font-semibold"
                style={{ background: roundDays === String(d) ? '#7c3aed' : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(124,58,237,0.08)'), color: roundDays === String(d) ? 'white' : textMain }}>
                {d === 7 ? 'Weekly' : d === 14 ? 'Fortnightly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void handleCreate()}
          disabled={!fundName || !contribution || memberCount < 1 || !isConnected || !!pendingAction}
          className="w-full py-4 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2"
          style={{ background: !fundName || !contribution || memberCount < 1 || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
        >
          {pendingAction === 'create'
            ? <><Loader2 size={20} className="animate-spin" /> Creating…</>
            : <><Users size={20} /> Start Committee</>}
        </button>

        {!isConnected && <p className="text-center text-sm" style={{ color: '#ef4444' }}>Connect your wallet first</p>}
      </div>
    </div>
  )

  // --- JOIN / CONTRIBUTE VIEW ---
  if (view === 'join') return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <button onClick={() => setView('home')} className="flex items-center gap-2 text-sm font-medium" style={{ color: '#7c3aed' }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div className="text-center py-2">
        <div className="text-4xl mb-1">💸</div>
        <h2 className="text-xl font-bold" style={{ color: textMain }}>Pay My Round</h2>
        <p className="text-sm mt-1" style={{ color: textMuted }}>Enter the committee ID given by the organizer</p>
      </div>

      <div style={card} className="space-y-4">
        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Committee ID</label>
          <p className="text-xs mb-2" style={{ color: textMuted }}>Ask the person who created the committee for this number</p>
          <input
            className="w-full rounded-xl px-4 py-3 text-xl font-bold outline-none text-center"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            placeholder="e.g. 0"
            type="number"
            min="0"
            value={fundIdInput}
            onChange={e => setFundIdInput(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Amount to pay (USDC)</label>
          <input
            className="w-full rounded-xl px-4 py-3 text-xl font-bold outline-none text-center"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            placeholder="e.g. 10"
            type="number"
            value={contribution}
            onChange={e => setContribution(e.target.value)}
          />
          {contribution && <p className="text-sm mt-1 font-medium text-center" style={{ color: '#16a34a' }}>{toInr(contribution)}</p>}
        </div>

        <div className="rounded-xl p-3 text-sm" style={{ background: darkMode ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', color: textMuted }}>
          Two steps will happen: first you approve, then the payment goes automatically. Keep MetaMask open.
        </div>

        <button
          onClick={() => void handleContribute(Number(fundIdInput), contribution)}
          disabled={!fundIdInput || !contribution || !isConnected || !!pendingAction}
          className="w-full py-4 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2"
          style={{ background: !fundIdInput || !contribution || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#16a34a,#15803d)' }}
        >
          {pendingAction === 'approve'
            ? <><Loader2 size={20} className="animate-spin" /> Step 1/2: Approving…</>
            : pendingAction === 'contribute'
            ? <><Loader2 size={20} className="animate-spin" /> Step 2/2: Paying…</>
            : <>💸 Pay My Round</>}
        </button>

        {!isConnected && <p className="text-center text-sm" style={{ color: '#ef4444' }}>Connect your wallet first</p>}
      </div>
    </div>
  )

  // --- DETAIL VIEW ---
  if (view === 'detail' && selectedFund) return (
    <DetailView
      fund={selectedFund}
      address={address}
      card={card}
      textMain={textMain}
      textMuted={textMuted}
      darkMode={!!darkMode}
      toInr={toInr}
      pendingAction={pendingAction}
      onBack={() => setView('home')}
      onPay={() => { setFundIdInput(String(selectedFund.id)); setContribution(fmt(selectedFund.contributionAmount)); setView('join') }}
      onCopy={() => { void navigator.clipboard.writeText(String(selectedFund.id)); toast.success('Fund ID copied!') }}
      resolveLabel={resolveLabel}
    />
  )

  return null
}

// ── DetailView — shows per-member paid/unpaid status for current round ──
interface DetailProps {
  fund: FundInfo
  address: string | undefined
  card: React.CSSProperties
  textMain: string
  textMuted: string
  darkMode: boolean
  toInr: (u: string | number) => string
  pendingAction: string
  onBack: () => void
  onPay: () => void
  onCopy: () => void
  resolveLabel: (addr: string) => string
}

function DetailView({ fund, address, card, textMain, textMuted, darkMode, toInr, pendingAction, onBack, onPay, onCopy, resolveLabel }: DetailProps) {
  const [paidStatus, setPaidStatus] = useState<Record<string, boolean>>({})
  const [loadingStatus, setLoadingStatus] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      setLoadingStatus(true)
      try {
        const batch = fund.members.map((m, idx) => ({
          jsonrpc: '2.0',
          id: idx,
          method: 'eth_call',
          params: [{
            to: FUND_ADDR,
            data: encodeFunctionData({
              abi: CHIT_FUND_ABI,
              functionName: 'hasPaid',
              args: [BigInt(fund.id), fund.currentRound, m as `0x${string}`]
            })
          }, 'latest']
        }))
        const resp = await fetch('https://rpc.mainnet.arc.io', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch)
        })
        const results: { id: number; result?: string }[] = await resp.json() as { id: number; result?: string }[]
        const map: Record<string, boolean> = {}
        for (const r of results) {
          const member = fund.members[r.id]
          if (member && r.result) {
            map[member.toLowerCase()] = r.result !== '0x' && r.result !== '0x0000000000000000000000000000000000000000000000000000000000000000'
          }
        }
        setPaidStatus(map)
      } catch { /* ignore */ }
      setLoadingStatus(false)
    }
    void fetchStatus()
  }, [fund])

  const recipientIdx = Number(fund.currentRound) % fund.members.length
  const recipient = fund.members[recipientIdx]
  const myAddr = address?.toLowerCase() ?? ''
  const iPaid = paidStatus[myAddr] ?? false
  const paidCount = Object.values(paidStatus).filter(Boolean).length
  const totalMembers = fund.members.length
  const deadline = Number(fund.roundDeadline)
  const deadlineStr = deadline > 0 ? new Date(deadline * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null

  return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-medium" style={{ color: '#7c3aed' }}>
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header */}
      <div style={card}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: textMain }}>{fund.name}</h2>
            <p className="text-xs" style={{ color: textMuted }}>Committee ID: {fund.id}</p>
          </div>
          <span className="text-xs px-2 py-1 rounded-full font-bold" style={{ background: fund.active ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)', color: fund.active ? '#16a34a' : '#ef4444' }}>
            {fund.active ? 'Active' : 'Ended'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-xl p-2 text-center" style={{ background: darkMode ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.07)' }}>
            <p className="text-xs" style={{ color: textMuted }}>Each pays</p>
            <p className="text-base font-bold" style={{ color: '#7c3aed' }}>${fmt(fund.contributionAmount)}</p>
            <p className="text-xs" style={{ color: textMuted }}>{toInr(fmt(fund.contributionAmount))}</p>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: darkMode ? 'rgba(22,163,74,0.15)' : 'rgba(22,163,74,0.07)' }}>
            <p className="text-xs" style={{ color: textMuted }}>Round</p>
            <p className="text-base font-bold" style={{ color: '#16a34a' }}>{Number(fund.currentRound) + 1}/{Number(fund.totalRounds)}</p>
            <p className="text-xs" style={{ color: textMuted }}>{totalMembers} members</p>
          </div>
          <div className="rounded-xl p-2 text-center" style={{ background: darkMode ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.07)' }}>
            <p className="text-xs" style={{ color: textMuted }}>Paid</p>
            <p className="text-base font-bold" style={{ color: '#ca8a04' }}>{loadingStatus ? '…' : `${paidCount}/${totalMembers}`}</p>
            <p className="text-xs" style={{ color: textMuted }}>this round</p>
          </div>
        </div>

        {deadlineStr && (
          <p className="text-xs text-center mb-3" style={{ color: textMuted }}>Round deadline: {deadlineStr}</p>
        )}
      </div>

      {/* My payment status */}
      {!loadingStatus && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{
          background: iPaid ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${iPaid ? 'rgba(22,163,74,0.3)' : 'rgba(239,68,68,0.3)'}`
        }}>
          <span className="text-2xl">{iPaid ? '✅' : '⏳'}</span>
          <div className="flex-1">
            <p className="font-bold text-sm" style={{ color: iPaid ? '#16a34a' : '#ef4444' }}>
              {iPaid ? 'You have paid this round' : 'You have not paid yet'}
            </p>
            <p className="text-xs" style={{ color: textMuted }}>
              {iPaid ? 'Waiting for others to pay' : `Pay $${fmt(fund.contributionAmount)} (${toInr(fmt(fund.contributionAmount))})`}
            </p>
          </div>
          {!iPaid && (
            <button
              onClick={onPay}
              disabled={!!pendingAction}
              className="px-3 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}
            >
              Pay Now
            </button>
          )}
        </div>
      )}

      {/* Who gets the pot */}
      {recipient && (
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
          <p className="text-white text-xs font-medium mb-1">This round's pot goes to</p>
          <p className="text-white font-bold text-base">
            {recipient.toLowerCase() === myAddr ? '🎉 YOU!' : resolveLabel(recipient)}
          </p>
          <p className="text-purple-200 text-xs mt-1">Total pot: ${(parseFloat(fmt(fund.contributionAmount)) * totalMembers).toFixed(2)} USDC</p>
        </div>
      )}

      {/* Members list with paid/unpaid */}
      <div style={card}>
        <p className="text-sm font-bold mb-3" style={{ color: textMain }}>All Members — Round {Number(fund.currentRound) + 1}</p>
        {loadingStatus ? (
          <div className="text-center py-3"><Loader2 size={18} className="animate-spin mx-auto" style={{ color: '#7c3aed' }} /></div>
        ) : (
          fund.members.map((m, i) => {
            const paid = paidStatus[m.toLowerCase()] ?? false
            const isMe = m.toLowerCase() === myAddr
            const getsPool = i === recipientIdx
            const label = isMe ? 'You' : resolveLabel(m)
            return (
              <div key={m} className="flex items-center justify-between py-2.5 border-b" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{paid ? '✅' : '⏳'}</span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: isMe ? '#7c3aed' : textMain }}>{label}</p>
                    <p className="text-xs font-mono" style={{ color: textMuted }}>{m.slice(0, 8)}…{m.slice(-5)}</p>
                    <p className="text-xs font-medium" style={{ color: paid ? '#16a34a' : '#ef4444' }}>
                      {paid ? '✓ Paid this round' : '⏳ Not paid yet'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {getsPool && <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(124,58,237,0.15)', color: '#7c3aed' }}>Gets pot 💰</span>}
                  <span className="text-xs" style={{ color: textMuted }}>Member #{i + 1}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* WhatsApp share */}
      <button
        onClick={() => {
          const msg = `Hey! I created a committee called "${fund.name}" on BachatPay.\n\nCommittee ID: *${fund.id}*\nYour contribution: $${fmt(fund.contributionAmount)} USDC per round\n\nDownload BachatPay and pay your round:\nhttps://bachatpay.xyz`
          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
        }}
        className="w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2"
        style={{ background: '#25d366' }}
      >
        <span className="text-lg">💬</span> Share on WhatsApp
      </button>

      {/* Copy ID */}
      <button
        onClick={onCopy}
        className="w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2"
        style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(124,58,237,0.08)', color: '#7c3aed' }}
      >
        <Copy size={16} /> Copy Committee ID
      </button>
    </div>
  )
}
