/**
 * ChitFund — Onchain ROSCA/Committee Savings tab
 * Built with Arc Studio — https://studio.arc.io
 * Designed for simplicity — works for first-time users and village communities
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits, formatUnits, isAddress } from 'viem'
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

interface Props { toInr: (u: string | number) => string; darkMode?: boolean }

export default function ChitFundTab({ toInr, darkMode }: Props) {
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<'home' | 'create' | 'join' | 'detail'>('home')
  const [fundName, setFundName] = useState('')
  const [contribution, setContribution] = useState('')
  const [members, setMembers] = useState('')
  const [roundDays, setRoundDays] = useState('7')
  const [fundIdInput, setFundIdInput] = useState('')
  const [selectedFund, setSelectedFund] = useState<FundInfo | null>(null)
  const [myFunds, _setMyFunds] = useState<FundInfo[]>([])
  const [loadingFunds, setLoadingFunds] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [pendingAction, setPendingAction] = useState('')
  const pendingContributeRef = useRef<{ fundId: number; amount: string } | null>(null)

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

  // Load user's funds by scanning all fund IDs
  const loadMyFunds = useCallback(async () => {
    if (!address || !totalFunds) return
    setLoadingFunds(true)
    const total = Number(totalFunds)
    const found: FundInfo[] = []
    // Read up to last 50 funds
    const start = Math.max(0, total - 50)
    for (let i = start; i < total; i++) {
      try {
        const res = await fetch(`https://rpc.mainnet.arc.io`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: i, method: 'eth_call',
            params: [{
              to: FUND_ADDR,
              data: encodeFunctionCall('getFund', [BigInt(i)])
            }, 'latest']
          })
        })
        // fallback: just use wagmi read below
        void res
      } catch { /* ignore */ }
    }
    // Use wagmi approach — read each fund and filter
    setLoadingFunds(false)
    return found
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

    toast.success('Done! Transaction confirmed.')
    queueMicrotask(() => {
      setPendingAction('')
      setTxHash(undefined)
      setView('home')
      setFundName(''); setContribution(''); setMembers(''); setFundIdInput('')
      confirmedRef.current = false
      void refetchTotal()
      void refetchClaim()
    })
  }, [txConfirmed, txHash, pendingAction, writeContractAsync, refetchTotal, refetchClaim])

  const handleCreate = useCallback(async () => {
    if (!fundName || !contribution || !members) return
    const memberList = members.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (memberList.length < 2) { toast.error('Add at least 2 member wallet addresses'); return }
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
  }, [fundName, contribution, members, roundDays, writeContractAsync])

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

      {myFunds.length > 0 && (
        <div style={card}>
          <h3 className="font-bold mb-3" style={{ color: textMain }}>Your Committees</h3>
          {myFunds.map(f => (
            <button
              key={f.id}
              onClick={() => { setSelectedFund(f); setView('detail') }}
              className="w-full text-left p-3 rounded-xl mb-2 flex items-center justify-between"
              style={{ background: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}
            >
              <div>
                <p className="font-semibold text-sm" style={{ color: textMain }}>{f.name}</p>
                <p className="text-xs mt-0.5" style={{ color: textMuted }}>{f.members.length} members · Round {Number(f.currentRound) + 1}/{Number(f.totalRounds)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold" style={{ color: '#7c3aed' }}>${fmt(f.contributionAmount)}</p>
                <p className="text-xs" style={{ color: textMuted }}>per round</p>
              </div>
            </button>
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
          <label className="text-sm font-bold block mb-1" style={{ color: textMain }}>Member Wallet Addresses</label>
          <p className="text-xs mb-2" style={{ color: textMuted }}>Add all members including yourself. One address per line. (2 to 20 people)</p>
          <textarea
            className="w-full rounded-xl px-4 py-3 text-xs outline-none resize-none font-mono"
            style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(124,58,237,0.2)', color: textMain }}
            rows={5}
            placeholder={'0xYourAddress\n0xFriend1Address\n0xFriend2Address'}
            value={members}
            onChange={e => setMembers(e.target.value)}
          />
          {memberCount >= 2 && <p className="text-xs mt-1 font-medium" style={{ color: '#7c3aed' }}>{memberCount} members added</p>}
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
          disabled={!fundName || !contribution || memberCount < 2 || !isConnected || !!pendingAction}
          className="w-full py-4 rounded-xl font-bold text-white text-base flex items-center justify-center gap-2"
          style={{ background: !fundName || !contribution || memberCount < 2 || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
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
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <button onClick={() => setView('home')} className="flex items-center gap-2 text-sm font-medium" style={{ color: '#7c3aed' }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div style={card}>
        <h2 className="text-lg font-bold mb-1" style={{ color: textMain }}>{selectedFund.name}</h2>
        <p className="text-sm mb-4" style={{ color: textMuted }}>Fund ID: {selectedFund.id}</p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl p-3 text-center" style={{ background: darkMode ? 'rgba(124,58,237,0.15)' : 'rgba(124,58,237,0.07)' }}>
            <p className="text-xs" style={{ color: textMuted }}>Each person pays</p>
            <p className="text-lg font-bold" style={{ color: '#7c3aed' }}>${fmt(selectedFund.contributionAmount)}</p>
            <p className="text-xs" style={{ color: textMuted }}>{toInr(fmt(selectedFund.contributionAmount))}</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: darkMode ? 'rgba(22,163,74,0.15)' : 'rgba(22,163,74,0.07)' }}>
            <p className="text-xs" style={{ color: textMuted }}>Round</p>
            <p className="text-lg font-bold" style={{ color: '#16a34a' }}>{Number(selectedFund.currentRound) + 1} / {Number(selectedFund.totalRounds)}</p>
            <p className="text-xs" style={{ color: textMuted }}>{selectedFund.members.length} members</p>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm font-bold mb-2" style={{ color: textMain }}>Members</p>
          {selectedFund.members.map((m, i) => (
            <div key={m} className="flex items-center justify-between py-2 border-b" style={{ borderColor: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }}>
              <p className="text-xs font-mono" style={{ color: textMuted }}>{m.slice(0, 10)}…{m.slice(-6)}</p>
              <div className="flex items-center gap-2">
                {m.toLowerCase() === selectedFund.members[Number(selectedFund.currentRound) % selectedFund.members.length]?.toLowerCase() && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(22,163,74,0.15)', color: '#16a34a' }}>Gets pot</span>
                )}
                <span className="text-xs" style={{ color: textMuted }}>#{i + 1}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { setFundIdInput(String(selectedFund.id)); setContribution(fmt(selectedFund.contributionAmount)); setView('join') }}
          className="w-full py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}
        >
          💸 Pay This Round
        </button>

        <button
          onClick={() => { void navigator.clipboard.writeText(String(selectedFund.id)); toast.success('Fund ID copied!') }}
          className="w-full py-3 rounded-xl font-semibold mt-2 flex items-center justify-center gap-2"
          style={{ background: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(124,58,237,0.08)', color: '#7c3aed' }}
        >
          <Copy size={16} /> Copy Fund ID to share
        </button>
      </div>
    </div>
  )

  return null
}

// Minimal helper — not actually used for the RPC approach above
function encodeFunctionCall(_name: string, _args: unknown[]): string {
  return '0x'
}
