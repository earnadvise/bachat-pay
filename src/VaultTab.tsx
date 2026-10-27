/**
 * BachatVault — Goal-Based Locked Savings tab
 * Built with Arc Studio — https://studio.arc.io
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi, parseUnits, formatUnits } from 'viem'
import { toast } from 'sonner'
import { PiggyBank, Lock, Unlock, Plus, Loader2, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react'
import { CONTRACTS, BACHAT_VAULT_ABI } from './contracts'

const ARC_CHAIN_ID = 5042
const USDC_MAINNET = '0x3600000000000000000000000000000000000000' as const
const USDC_DECIMALS = 6
const VAULT_ADDR = CONTRACTS.bachatVault.mainnet
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
const fmtDate = (ts: number) => ts === 0 ? 'No date' : new Date(ts * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

interface Props { toInr: (u: string | number) => string }

export default function VaultTab({ toInr }: Props) {
  const { address, isConnected } = useAccount()
  const [view, setView] = useState<'list' | 'create'>('list')
  const [goalName, setGoalName] = useState('')
  const [targetAmt, setTargetAmt] = useState('')
  const [unlockDate, setUnlockDate] = useState('')
  const [depositVaultId, setDepositVaultId] = useState('')
  const [depositAmt, setDepositAmt] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [pendingAction, setPendingAction] = useState<string>('')

  const { writeContractAsync } = useWriteContract()
  const { data: vaultIds, refetch: refetchIds } = useReadContract({
    address: VAULT_ADDR,
    abi: BACHAT_VAULT_ABI,
    functionName: 'getUserVaults',
    args: address ? [address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address },
  })

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash, chainId: ARC_CHAIN_ID })
  const confirmedRef = useRef(false)
  useEffect(() => {
    if (!txConfirmed || !txHash || confirmedRef.current) return
    confirmedRef.current = true
    toast.success('Transaction confirmed!')
    void refetchIds()
    queueMicrotask(() => {
      setPendingAction('')
      setTxHash(undefined)
      setView('list')
      confirmedRef.current = false
    })
  }, [txConfirmed, txHash, refetchIds])

  const handleCreate = useCallback(async () => {
    if (!goalName || !address) return
    try {
      setPendingAction('create')
      const unlockTime = unlockDate ? BigInt(Math.floor(new Date(unlockDate).getTime() / 1000)) : 0n
      const target = targetAmt ? parseUnits(targetAmt, USDC_DECIMALS) : 0n
      const hash = await writeContractAsync({
        address: VAULT_ADDR,
        abi: BACHAT_VAULT_ABI,
        functionName: 'createVault',
        args: [goalName, target, unlockTime],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Creating vault…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [goalName, targetAmt, unlockDate, address, writeContractAsync])

  const handleApproveDeposit = useCallback(async () => {
    if (!depositVaultId || !depositAmt || !address) return
    try {
      setPendingAction('approve')
      const hash = await writeContractAsync({
        address: USDC_MAINNET,
        abi: erc20Abi,
        functionName: 'approve',
        args: [VAULT_ADDR, parseUnits(depositAmt, USDC_DECIMALS)],
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      toast('Approving USDC…')
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 80) ?? 'Failed')
      setPendingAction('')
    }
  }, [depositVaultId, depositAmt, address, writeContractAsync])

  const ids = (vaultIds as bigint[] | undefined) ?? []

  return (
    <div className="pb-24 px-4 pt-4 space-y-4 max-w-md mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#0f1c35' }}>Bachat Vault</h2>
          <p className="text-xs" style={{ color: '#6b7c99' }}>Goal-based savings. Early exit = 2% penalty.</p>
        </div>
        <button
          onClick={() => setView(v => v === 'list' ? 'create' : 'list')}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}
        >
          <Plus size={16} /> New Vault
        </button>
      </div>

      {/* Create vault form */}
      {view === 'create' && (
        <div className="rounded-2xl p-4 space-y-3" style={glass.card}>
          <h3 className="font-semibold" style={{ color: '#0f1c35' }}>Create a Savings Goal</h3>
          <input
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
            placeholder="Goal name (e.g. Festival Bachat)"
            value={goalName}
            onChange={e => setGoalName(e.target.value)}
          />
          <input
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
            placeholder="Target amount in USDC (optional)"
            type="number"
            min="0"
            value={targetAmt}
            onChange={e => setTargetAmt(e.target.value)}
          />
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: '#6b7c99' }}>Unlock date (optional)</label>
            <input
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
              type="date"
              value={unlockDate}
              onChange={e => setUnlockDate(e.target.value)}
            />
          </div>
          {targetAmt && (
            <p className="text-xs" style={{ color: '#16a34a' }}>Target: ${targetAmt} USDC ({toInr(targetAmt)})</p>
          )}
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)' }}>
            <AlertTriangle size={14} style={{ color: '#d97706' }} />
            <p className="text-xs" style={{ color: '#92400e' }}>Withdrawing before goal = 2% ragequit penalty</p>
          </div>
          <button
            onClick={() => void handleCreate()}
            disabled={!goalName || !isConnected || pendingAction === 'create'}
            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: !goalName || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#16a34a,#15803d)' }}
          >
            {pendingAction === 'create' ? <><Loader2 size={18} className="animate-spin" /> Creating…</> : <><PiggyBank size={18} /> Create Vault</>}
          </button>
        </div>
      )}

      {/* Deposit form */}
      <div className="rounded-2xl p-4 space-y-3" style={glass.card}>
        <h3 className="font-semibold" style={{ color: '#0f1c35' }}>Deposit to Vault</h3>
        <input
          className="w-full rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
          placeholder="Vault ID"
          type="number"
          value={depositVaultId}
          onChange={e => setDepositVaultId(e.target.value)}
        />
        <input
          className="w-full rounded-xl px-4 py-3 text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.1)', color: '#0f1c35' }}
          placeholder="Amount in USDC"
          type="number"
          value={depositAmt}
          onChange={e => setDepositAmt(e.target.value)}
        />
        {depositAmt && <p className="text-xs" style={{ color: '#16a34a' }}>{toInr(depositAmt)}</p>}
        <button
          onClick={() => void handleApproveDeposit()}
          disabled={!depositVaultId || !depositAmt || !isConnected || !!pendingAction}
          className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: !depositVaultId || !depositAmt || !isConnected ? '#94a3b8' : 'linear-gradient(135deg,#2563eb,#1d4ed8)' }}
        >
          {pendingAction === 'approve' ? <><Loader2 size={18} className="animate-spin" /> Approving…</> : <><Lock size={18} /> Approve & Deposit</>}
        </button>
      </div>

      {/* Vault list */}
      {isConnected && ids.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3" style={glass.card}>
          <h3 className="font-semibold" style={{ color: '#0f1c35' }}>Your Vaults ({ids.length})</h3>
          {ids.map(id => (
            <VaultRow key={String(id)} vaultId={id} toInr={toInr} writeContractAsync={writeContractAsync} explorer={EXPLORER} chainId={ARC_CHAIN_ID} />
          ))}
        </div>
      )}
      {isConnected && ids.length === 0 && view !== 'create' && (
        <div className="rounded-2xl p-8 text-center" style={glass.card}>
          <PiggyBank size={40} className="mx-auto mb-3" style={{ color: '#2563eb' }} />
          <p className="font-semibold" style={{ color: '#0f1c35' }}>No vaults yet</p>
          <p className="text-sm mt-1" style={{ color: '#6b7c99' }}>Create a savings goal to get started</p>
        </div>
      )}
      {txHash && (
        <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs justify-center" style={{ color: '#2563eb' }}>
          <ExternalLink size={12} /> View transaction
        </a>
      )}
    </div>
  )
}

interface VaultRowProps {
  vaultId: bigint
  toInr: (u: string | number) => string
  writeContractAsync: ReturnType<typeof useWriteContract>['writeContractAsync']
  explorer: string
  chainId: number
}

// Computed once at module load — close enough for unlock date comparisons
const MODULE_NOW_SECS = Math.floor(Date.now() / 1000)

function VaultRow({ vaultId, toInr, writeContractAsync, explorer, chainId }: VaultRowProps) {
  const { data } = useReadContract({
    address: VAULT_ADDR,
    abi: BACHAT_VAULT_ABI,
    functionName: 'getVault',
    args: [vaultId],
    chainId,
  })
  const [withdrawHash, setWithdrawHash] = useState<`0x${string}` | undefined>()
  const [busy, setBusy] = useState(false)
  const { isSuccess: withdrawDone } = useWaitForTransactionReceipt({ hash: withdrawHash, chainId })
  const withdrawRef = useRef(false)
  useEffect(() => {
    if (!withdrawDone || !withdrawHash || withdrawRef.current) return
    withdrawRef.current = true
    toast.success('Withdrawal complete!')
    queueMicrotask(() => { setBusy(false); withdrawRef.current = false })
  }, [withdrawDone, withdrawHash])

  if (!data) return null
  const vault = data as { owner: string; goalName: string; targetAmount: bigint; unlockTime: bigint; balance: bigint; withdrawn: boolean }
  const balance = fmt(vault.balance)
  const target = vault.targetAmount > 0n ? fmt(vault.targetAmount) : null
  const unlock = vault.unlockTime > 0n ? fmtDate(Number(vault.unlockTime)) : null
  const timeMet = vault.unlockTime === 0n || Number(vault.unlockTime) <= MODULE_NOW_SECS
  const amtMet = vault.targetAmount === 0n || vault.balance >= vault.targetAmount
  const goalMet = timeMet && amtMet
  const progress = target ? Math.min(100, (parseFloat(balance) / parseFloat(target)) * 100) : null

  const handleWithdraw = async () => {
    setBusy(true)
    try {
      const hash = await writeContractAsync({ address: VAULT_ADDR, abi: BACHAT_VAULT_ABI, functionName: 'withdraw', args: [vaultId], chainId })
      setWithdrawHash(hash)
    } catch (e) { toast.error((e as Error).message?.slice(0, 80) ?? 'Failed'); setBusy(false) }
  }

  if (vault.withdrawn) return (
    <div className="flex items-center gap-3 p-3 rounded-xl opacity-50" style={{ background: 'rgba(0,0,0,0.04)' }}>
      <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: '#0f1c35' }}>#{String(vaultId)} {vault.goalName}</p>
        <p className="text-xs" style={{ color: '#6b7c99' }}>Withdrawn</p>
      </div>
    </div>
  )

  return (
    <div className="p-3 rounded-xl space-y-2" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold" style={{ color: '#0f1c35' }}>#{String(vaultId)} {vault.goalName}</p>
          <p className="text-xs" style={{ color: '#6b7c99' }}>
            ${balance} USDC {target ? `/ $${target}` : ''} {toInr ? `· ${toInr(balance)}` : ''}
          </p>
          {unlock && <p className="text-xs" style={{ color: '#6b7c99' }}>Unlocks: {unlock}</p>}
        </div>
        {goalMet
          ? <Unlock size={18} style={{ color: '#16a34a' }} />
          : <Lock size={18} style={{ color: '#d97706' }} />}
      </div>
      {progress !== null && (
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: goalMet ? '#16a34a' : '#2563eb' }} />
        </div>
      )}
      {!goalMet && (
        <p className="text-xs" style={{ color: '#d97706' }}>Early withdrawal = 2% penalty · {toInr(parseFloat(balance) * 0.02)} goes to community pool</p>
      )}
      <button
        onClick={() => void handleWithdraw()}
        disabled={busy || vault.balance === 0n}
        className="w-full py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
        style={{ background: vault.balance === 0n ? '#94a3b8' : goalMet ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#d97706,#b45309)' }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : goalMet ? <><CheckCircle2 size={14} /> Withdraw (no penalty)</> : <><AlertTriangle size={14} /> Ragequit (2% fee)</>}
      </button>
      {withdrawHash && (
        <a href={`${explorer}/tx/${withdrawHash}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs justify-center" style={{ color: '#2563eb' }}>
          <ExternalLink size={10} /> View tx
        </a>
      )}
    </div>
  )
}
