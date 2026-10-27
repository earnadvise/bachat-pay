/**
 * BachatPay — contract addresses and ABIs
 * Built with Arc Studio — https://studio.arc.io
 */

// Arc Mainnet (chain 5042) — all contracts
export const CONTRACTS = {
  nanoPay: {
    mainnet: '0xa5d6C4a683d18a0f38CB68eC5345B95a17DEf306' as `0x${string}`,
  },
  bachatVault: {
    mainnet: '0x268c18C0367b1Bafc81C53f3C3EBA81C321ec130' as `0x${string}`,
  },
  chitFund: {
    mainnet: '0x18129a7d1F97e4BDda369AF67925e63B01536bF9' as `0x${string}`,
  },
}

export const BACHAT_VAULT_ABI = [
  { name: 'createVault', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'goalName', type: 'string' }, { name: 'targetAmount', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' }], outputs: [{ name: 'vaultId', type: 'uint256' }] },
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'vaultId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'vaultId', type: 'uint256' }], outputs: [] },
  { name: 'getVault', type: 'function', stateMutability: 'view', inputs: [{ name: 'vaultId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'owner', type: 'address' }, { name: 'goalName', type: 'string' }, { name: 'targetAmount', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' }, { name: 'balance', type: 'uint256' }, { name: 'withdrawn', type: 'bool' }] }] },
  { name: 'getUserVaults', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] },
  { name: 'totalVaults', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'VaultCreated', type: 'event', inputs: [{ name: 'vaultId', type: 'uint256', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'goalName', type: 'string' }, { name: 'targetAmount', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' }] },
  { name: 'Deposited', type: 'event', inputs: [{ name: 'vaultId', type: 'uint256', indexed: true }, { name: 'amount', type: 'uint256' }] },
  { name: 'Withdrawn', type: 'event', inputs: [{ name: 'vaultId', type: 'uint256', indexed: true }, { name: 'amount', type: 'uint256' }, { name: 'earlyPenalty', type: 'bool' }] },
] as const

export const CHIT_FUND_ABI = [
  { name: 'createFund', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'string' }, { name: 'contributionAmount', type: 'uint256' }, { name: 'members', type: 'address[]' }, { name: 'roundDuration', type: 'uint256' }], outputs: [{ name: 'fundId', type: 'uint256' }] },
  { name: 'contribute', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'fundId', type: 'uint256' }], outputs: [] },
  { name: 'disburse', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'fundId', type: 'uint256' }], outputs: [] },
  { name: 'claim', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'skipDeadlinedRound', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'fundId', type: 'uint256' }], outputs: [] },
  { name: 'getFund', type: 'function', stateMutability: 'view', inputs: [{ name: 'fundId', type: 'uint256' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'admin', type: 'address' }, { name: 'name', type: 'string' }, { name: 'contributionAmount', type: 'uint256' }, { name: 'currentRound', type: 'uint256' }, { name: 'totalRounds', type: 'uint256' }, { name: 'active', type: 'bool' }, { name: 'members', type: 'address[]' }, { name: 'roundDeadline', type: 'uint256' }, { name: 'roundDuration', type: 'uint256' }] }] },
  { name: 'hasPaid', type: 'function', stateMutability: 'view', inputs: [{ name: 'fundId', type: 'uint256' }, { name: 'round', type: 'uint256' }, { name: 'member', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'isRoundComplete', type: 'function', stateMutability: 'view', inputs: [{ name: 'fundId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'pendingClaims', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalFunds', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'FundCreated', type: 'event', inputs: [{ name: 'fundId', type: 'uint256', indexed: true }, { name: 'admin', type: 'address', indexed: true }, { name: 'name', type: 'string' }, { name: 'contributionAmount', type: 'uint256' }, { name: 'totalRounds', type: 'uint256' }] },
  { name: 'Contributed', type: 'event', inputs: [{ name: 'fundId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint256', indexed: true }, { name: 'member', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
  { name: 'Disbursed', type: 'event', inputs: [{ name: 'fundId', type: 'uint256', indexed: true }, { name: 'round', type: 'uint256', indexed: true }, { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
] as const
