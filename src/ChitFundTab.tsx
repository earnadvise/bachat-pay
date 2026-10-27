/**
 * ChitFund — Onchain ROSCA/Committee Savings tab
 * Built with Arc Studio — https://studio.arc.io
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits, formatUnits, isAddress } from 'viem'
import { toast } from 'sonner'
import { Users, Plus, Loader2, ExternalLink, CheckCircle2, Gift } from 'lucide-react'
import { CONTRACTS, CHIT_FUND_ABI } from './contracts'

const ARC_CHAIN_ID = 5042
const USDC_MAINNET = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const FUND_ADDR = CONTRACTS.chitFund.mainnet
const EXPLORER = 'https://explorer.arc.io'

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 8px 32px rgba(18,45,69,0.08), inset 0 1px 0 rgba(255,255,255,0.55)',
  } as React.CSSProperties,
}

const fmt = (raw: bigint) => parseFloat(formatUnits(raw, USDC_DECIMALS)).toFixed(2)

interface Props { toInr: (u: string | number) => string }

export default function ChitFundTab({ toInr }: Props) {
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<'list' | 'create' | 'contribute'>('list')
  const [fundName, setFundName] = useState('')
  const [contribution, setContribution] = useState('')
  const [members, setMembers] = useState('')
  const [roundDays, setRoundDays] = useState('7')
  const [fundIdInput, setFundIdInput] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [pendingAction, setPendingAction] = useState('')

  const { writeContractAsync } = useWriteContract()
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash, chainId: ARC_CHAIN_ID })
  const confirmedRef = useRef(false)
  useEffect(() => {
    if (!txConfirmed || !txHash || confirmedRef.current) return
    confirmedRef.current = true
    toast.success('Transaction confirmed!')
    queueMicrotask(() => {
      setPendingAction('')
      setTxHash(undefined)
      setView('list')
      confirmedRef.current = false
    })
  }, [txConfirmed, txHash])

  const { data: pendingClaim } = useReadContract({
    address: FUND_ADDR,
    abi: CHIT_FUND_ABI,
    functionName: 'pendingClaims',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  })

  const handleCreate = useCallback(async () => {
    if (!fundName || !contribution || !members) return
    const memberList = members.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    if (memberList.length < 2 || memberList.length > 20) { toast.error('Need 2–20 members'); return }
    if (memberList.some(m => !isAddress(m))) { toast.error('Invalid address in members'); return }
    try {
      setPendingAction('create')
      const roundDuration = BigInt(Number(roundDays) * 86400)
      const hash = await writeContractAsync({
        address: FUND_ADDR,
        abi: CHIT_FUND_ABI,
        functionName: 'createFund',
        args: [fundName, parseUnits(contribution, USDC_DECIMALS), memberList as `0x${string}`[], roundDuration],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Creating chit fund…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [fundName, contribution, members, roundDays, writeContractAsync])

  const handleApprove = useCallback(async () => {
    if (!fundIdInput || !contribution) return
    try {
      setPendingAction('approve')
      const hash = await writeContractAsync({
        address: USDC_MAINNET,
        abi: erc20Abi,
        functionName: 'approve',
        args: [FUND_ADDR, parseUnits(contribution, USDC_DECIMALS)],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [fundIdInput, contribution, writeContractAsync])

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
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [writeContractAsync])

  const claimAmt = pendingClaim ? fmt(pendingClaim) : '0'

  return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#0f1c35' }}>Chit Fund</h2>
          <p className="text-xs" style={{ color: '#6b7c99' }}>Group ROSCA savings. Everyone contributes, one person gets paid per round.</p>
        </div>
        <button
          onClick={() => setView(v => v === 'list' ? 'create' : 'list')}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
        >
          <Plus size={16} /> New Fund
        </button>
      </div>

      {/* Pending claim banner */}
      {parseFloat(claimAmt) > 0 && (
        <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
          <div>
            <p className="text-sm font-bold text-white">You have funds to claim!</p>
            <p className="text-xs text-green-100">${claimAmt} USDC · {toInr(claimAmt)}</p>
          </div>
          <button
            onClick={() => void handleClaim()}
            disabled={pendingAction === 'claim'}
            className="px-4 py-2 rounded-xl text-sm font-bold text-green-700 bg-white flex items-center gap-2"
          >
            {pendingAction === 'claim' ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
            Claim
          </button>
        </div>
      )}

      {/* Create form */}
      {view === 'create' && (
        <div className="rounded-2xl p-4 space-y-3" style={glass.card}>
          <h3 className="font-semibold" style={{ color: '#0f1c35' }}>Start a Chit Fund</h3>
          <input
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
            placeholder="Fund name (e.g. Friends Committee)"
            value={fundName}
            onChange={e => setFundName(e.target.value)}
          />
          <input
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
            placeholder="Contribution per member per round (USDC)"
            type="number"
            value={contribution}
            onChange={e => setContribution(e.target.value)}
          />
          {contribution && <p className="text-xs" style={{ color: '#16a34a' }}>Per member: ${contribution} ({toInr(contribution)})</p>}
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: '#6b7c99' }}>Member wallet addresses (one per line or comma-separated, 2–20)</label>
            <textarea
              className="w-full rounded-xl px-4 py-3 text-xs outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
              rows={4}
              placeholder={'0xAbc...\n0xDef...'}
              value={members}
              onChange={e => setMembers(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: '#6b7c99' }}>Round duration (days)</label>
            <input
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
              type="number"
              min="1"
              value={roundDays}
              onChange={e => setRoundDays(e.target.value)}
            />
          </div>
          <div className="p-3 rounded-xl text-xs" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', color: '#6d28d9' }}>
            Total payout per round = ${contribution ? (parseFloat(contribution) * members.split(/[\n,]+/).filter(s => s.trim()).length).toFixed(2) : '0'} USDC
          </div>
          <button
            onClick={() => void handleCreate()}
            disabled={!fundName || !contribution || !members || !isConnected || pendingAction === 'create'}
            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: !fundName || !contribution || !members || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
          >
            {pendingAction === 'create' ? <><Loader2 size={18} className="animate-spin" /> Creating…</> : <><Users size={18} /> Create Chit Fund</>}
          </button>
        </div>
      )}

      {/* Contribute form */}
      <div className="rounded-2xl p-4 space-y-3" style={glass.card}>
        <h3 className="font-semibold" style={{ color: '#0f1c35' }}>Contribute to a Fund</h3>
        <input
          className="w-full rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
          placeholder="Fund ID"
          type="number"
          value={fundIdInput}
          onChange={e => setFundIdInput(e.target.value)}
        />
        <input
          className="w-full rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
          placeholder="Contribution amount (USDC)"
          type="number"
          value={contribution}
          onChange={e => setContribution(e.target.value)}
        />
        {contribution && <p className="text-xs" style={{ color: '#16a34a' }}>{toInr(contribution)}</p>}
        <button
          onClick={() => void handleApprove()}
          disabled={!fundIdInput || !contribution || !isConnected || !!pendingAction}
          className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: !fundIdInput || !contribution || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
        >
          {pendingAction === 'approve' ? <><Loader2 size={18} className="animate-spin" /> Approving…</> : 'Approve & Contribute'}
        </button>
      </div>

      {/* How it works */}
      <div className="rounded-2xl p-4 space-y-2" style={glass.card}>
        <h3 className="font-semibold flex items-center gap-2" style={{ color: '#0f1c35' }}><Users size={16} /> How Chit Fund works</h3>
        {[
          '1. Create a fund with 2–20 members and a fixed contribution',
          '2. Each member approves and contributes every round',
          '3. The pooled USDC goes to members in rotation — round by round',
          '4. After all members have received once, the fund completes',
          '5. If a member misses the deadline, any member can skip them',
        ].map(s => (
          <p key={s} className="text-xs" style={{ color: '#6b7c99' }}>{s}</p>
        ))}
      </div>

      {txHash && (
        <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs justify-center" style={{ color: '#7c3aed' }}>
          <ExternalLink size={12} /> <CheckCircle2 size={12} /> View transaction
        </a>
      )}
    </div>
  )
}
