/**
 * BachatPay — Unified Balance Panel
 * Shows cross-chain USDC balance via Circle App Kit (EIP-1193 / wagmi adapter).
 * Allows depositing USDC from any supported chain into the unified balance,
 * then spending it on Arc Testnet.
 */
import { useState } from 'react'
import { useAccount, useConnectorClient } from 'wagmi'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { AppKit } from '@circle-fin/app-kit'
import type { EIP1193Provider } from 'viem'
import { Layers, RefreshCw, Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { toast } from 'sonner'

const appKit = new AppKit()

const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.10)',
    borderRadius: '1.5rem',
    padding: '1.5rem',
  } as React.CSSProperties,
  inner: {
    background: 'var(--surface-muted)',
    borderRadius: '1rem',
    padding: '0.75rem 1rem',
  } as React.CSSProperties,
}

// Chains supported by Unified Balance on testnet
const CHAINS = [
  { label: 'Arc Testnet', id: 5042002, sdk: 'Arc_Testnet' as const },
  { label: 'Base Sepolia', id: 84532, sdk: 'Base_Sepolia' as const },
  { label: 'Arbitrum Sepolia', id: 421614, sdk: 'Arbitrum_Sepolia' as const },
  { label: 'Ethereum Sepolia', id: 11155111, sdk: 'Ethereum_Sepolia' as const },
]

interface BalanceEntry {
  chain: string
  confirmedBalance: string
}

interface UnifiedBalanceProps {
  contractAddress: `0x${string}`
}

export function UnifiedBalance({ contractAddress }: UnifiedBalanceProps) {
  const { address, isConnected } = useAccount()
  const { data: connectorClient } = useConnectorClient()

  const [balances, setBalances] = useState<BalanceEntry[]>([])
  const [totalBalance, setTotalBalance] = useState<string | null>(null)
  const [loadingBalances, setLoadingBalances] = useState(false)

  const [depositChain, setDepositChain] = useState(CHAINS[0])
  const [depositAmount, setDepositAmount] = useState('0.10')
  const [depositing, setDepositing] = useState(false)
  const [depositTx, setDepositTx] = useState<string | null>(null)

  const [spending, setSpending] = useState(false)
  const [spendTx, setSpendTx] = useState<string | null>(null)

  const getAdapter = async (chainId: number) => {
    if (!connectorClient) throw new Error('Wallet not connected')
    const provider = (connectorClient.transport as unknown as { request: EIP1193Provider['request'] })
    return await createViemAdapterFromProvider({ provider: provider as EIP1193Provider })
  }

  const handleFetchBalances = async () => {
    if (!connectorClient) { toast.error('Connect wallet first'); return }
    setLoadingBalances(true)
    try {
      const provider = (connectorClient.transport as unknown as { request: EIP1193Provider['request'] })
      const adapter = await createViemAdapterFromProvider({ provider: provider as EIP1193Provider })
      const result = await appKit.unifiedBalance.getBalances({
        sources: { adapter },
        networkType: 'testnet',
      })
      setTotalBalance(result.totalConfirmedBalance)
      const breakdown = result.breakdown?.[0]?.breakdown ?? []
      setBalances(breakdown.map(b => ({ chain: b.chain, confirmedBalance: b.confirmedBalance })))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to fetch balances')
    } finally {
      setLoadingBalances(false)
    }
  }

  const handleDeposit = async () => {
    if (!parseFloat(depositAmount)) { toast.error('Enter an amount'); return }
    setDepositing(true)
    setDepositTx(null)
    try {
      const adapter = await getAdapter(depositChain.id)
      const result = await appKit.unifiedBalance.deposit({
        from: { adapter, chain: depositChain.sdk },
        amount: depositAmount,
      })
      setDepositTx(result.txHash)
      toast.success(`Deposited $${depositAmount} USDC from ${depositChain.label}`)
      void handleFetchBalances()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setDepositing(false)
    }
  }

  const handleSpendOnArc = async () => {
    if (!address) { toast.error('Connect wallet first'); return }
    setSpending(true)
    setSpendTx(null)
    try {
      const adapter = await getAdapter(84532) // spend from Base Sepolia allocation
      const result = await appKit.unifiedBalance.spend({
        from: {
          adapter,
          allocations: { amount: '0.10', chain: 'Base_Sepolia' },
        },
        to: {
          chain: 'Arc_Testnet',
          recipientAddress: contractAddress,
          useForwarder: true,
        },
        amount: '0.10',
      })
      setSpendTx(result.txHash)
      toast.success('Spent $0.10 USDC on Arc Testnet via unified balance!')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Spend failed')
    } finally {
      setSpending(false)
    }
  }

  const explorerBase = 'https://explorer.testnet.arc.io/tx/'

  return (
    <div style={glass.card}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(18,45,69,0.08)' }}>
            <Layers className="size-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <p className="display font-600 text-sm" style={{ color: 'var(--ink)', fontWeight: 600 }}>Unified Balance</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>USDC across all chains — powered by Circle</p>
          </div>
        </div>
        <button
          onClick={() => { void handleFetchBalances() }}
          disabled={loadingBalances || !isConnected}
          className="size-8 rounded-xl flex items-center justify-center disabled:opacity-40 transition-all hover:scale-105"
          style={{ background: 'var(--surface-muted)' }}
        >
          <RefreshCw className={`size-3.5 ${loadingBalances ? 'animate-spin' : ''}`} style={{ color: 'var(--muted)' }} />
        </button>
      </div>

      {/* Balance display */}
      {totalBalance != null && (
        <div className="mb-4" style={glass.inner}>
          <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Total confirmed balance</p>
          <p className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            ${totalBalance} <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </p>
          {balances.length > 0 && (
            <div className="mt-2 space-y-1">
              {balances.map(b => (
                <div key={b.chain} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--muted)' }}>{b.chain.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums font-medium" style={{ color: 'var(--ink-2)' }}>${b.confirmedBalance}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isConnected && (
        <p className="text-xs text-center py-2 mb-4" style={{ color: 'var(--muted)' }}>Connect wallet to view and manage your unified balance</p>
      )}

      {/* Deposit */}
      <div className="mb-3">
        <p className="text-xs font-600 mb-2" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Deposit USDC to unified balance</p>
        <div className="flex gap-2 mb-2">
          <select
            value={depositChain.id}
            onChange={e => {
              const c = CHAINS.find(ch => ch.id === Number(e.target.value))
              if (c) setDepositChain(c)
            }}
            className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          >
            {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input
            inputMode="decimal"
            value={depositAmount}
            onChange={e => { setDepositAmount(e.target.value.replace(/[^0-9.]/g, '')) }}
            className="w-20 rounded-xl px-3 py-2 text-xs text-right tabular-nums outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
            placeholder="0.00"
          />
        </div>
        <button
          onClick={() => { void handleDeposit() }}
          disabled={depositing || !isConnected}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-600 transition-all disabled:opacity-40 hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#fff', fontWeight: 600 }}
        >
          {depositing
            ? <><Loader2 className="size-3 animate-spin" /> Depositing…</>
            : <><ArrowDownToLine className="size-3" /> Deposit ${depositAmount} USDC</>}
        </button>
        {depositTx && (
          <a href={`${explorerBase}${depositTx}`} target="_blank" rel="noreferrer" className="block text-center mt-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
            View deposit tx
          </a>
        )}
      </div>

      {/* Spend on Arc */}
      <div>
        <p className="text-xs font-600 mb-2" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>Spend on Arc Testnet (pay gateway)</p>
        <button
          onClick={() => { void handleSpendOnArc() }}
          disabled={spending || !isConnected}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-600 transition-all disabled:opacity-40 hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)', fontWeight: 600 }}
        >
          {spending
            ? <><Loader2 className="size-3 animate-spin" /> Spending…</>
            : <><ArrowUpFromLine className="size-3" /> Spend $0.10 on Arc via unified balance</>}
        </button>
        {spendTx && (
          <a href={`${explorerBase}${spendTx}`} target="_blank" rel="noreferrer" className="block text-center mt-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
            View spend tx
          </a>
        )}
      </div>
    </div>
  )
}
