/**
 * BachatPay — Landing Page
 * Built with Arc Studio — https://studio.arc.io
 */
import { useEffect, useRef, useState } from 'react'
import {
  Send, QrCode, PiggyBank, Users, Zap, Shield, Globe,
  ArrowRight, ChevronDown, ExternalLink,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'

// ── Constants ──────────────────────────────────────────────────────────────────
const APP_URL = 'https://bachat-pay.vercel.app'
const GITHUB_URL = 'https://github.com/earnadvise/bachat-pay'
const EXPLORER_URL = 'https://explorer.arc.io'
const CONTRACTS = [
  { name: 'NanoPayGateway', address: '0xa5d6C4a683d18a0f38CB68eC5345B95a17DEf306' },
  { name: 'BachatVault', address: '0x268c18C0367b1Bafc81C53f3C3EBA81C321ec130' },
  { name: 'ChitFund', address: '0x18129a7d1F97e4BDda369AF67925e63B01536bF9' },
]

// ── Animation helpers ──────────────────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useInView()
  return (
    <div ref={ref} className={className} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(28px)',
      transition: `opacity 0.65s ease ${delay}ms, transform 0.65s ease ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

// ── Floating USDC orbs ─────────────────────────────────────────────────────────
function FloatingOrb({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute',
      width: 64, height: 64,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.12)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      ...style,
    }}>
      <TokenUSDC size={32} />
    </div>
  )
}

// ── Feature card ───────────────────────────────────────────────────────────────
interface FeatureCardProps { icon: React.ReactNode; title: string; desc: string; color: string; delay: number }
function FeatureCard({ icon, title, desc, color, delay }: FeatureCardProps) {
  return (
    <FadeIn delay={delay}>
      <div style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.72)',
        boxShadow: '0 8px 32px rgba(18,45,69,0.08)',
        borderRadius: 20,
        padding: '24px',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
          boxShadow: `0 4px 16px ${color}55`,
        }}>
          {icon}
        </div>
        <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, fontWeight: 700, color: '#0f1c35', marginBottom: 8, letterSpacing: '-0.01em' }}>
          {title}
        </h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6b7c99' }}>{desc}</p>
      </div>
    </FadeIn>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 36, fontWeight: 800, color: '#0f1c35', letterSpacing: '-0.03em', tabularNums: true } as React.CSSProperties}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: '#6b7c99', marginTop: 4, fontWeight: 500 }}>{label}</div>
    </div>
  )
}

// ── Main landing page ──────────────────────────────────────────────────────────
export default function LandingPage({ onEnterApp }: { onEnterApp: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copyAddr = (addr: string) => {
    void navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div style={{
      minHeight: '100dvh',
      fontFamily: 'DM Sans, sans-serif',
      background: '#f0f4ff',
      overflowX: 'hidden',
    }}>

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <section style={{
        position: 'relative',
        minHeight: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '80px 24px 48px',
        overflow: 'hidden',
      }}>
        {/* Background gradient */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(145deg, #1e3a8a 0%, #1d4ed8 35%, #2563eb 60%, #3b82f6 100%)', zIndex: 0 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 70%)', zIndex: 1 }} />

        {/* Floating orbs */}
        <FloatingOrb style={{ top: '15%', left: '8%', animation: 'float1 6s ease-in-out infinite' }} />
        <FloatingOrb style={{ top: '25%', right: '10%', width: 48, height: 48, animation: 'float2 8s ease-in-out infinite' }} />
        <FloatingOrb style={{ bottom: '20%', left: '15%', width: 40, height: 40, animation: 'float3 7s ease-in-out infinite' }} />
        <FloatingOrb style={{ bottom: '30%', right: '8%', animation: 'float1 9s ease-in-out infinite reverse' }} />

        {/* Nav */}
        <nav style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 32px',
          zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}>
              <TokenUSDC size={20} />
            </div>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: '-0.01em' }}>BachatPay</span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>GitHub</a>
            <button onClick={onEnterApp} style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 12, padding: '8px 18px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Open App
            </button>
          </div>
        </nav>

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 600 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 100, padding: '6px 16px',
            fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 600,
            marginBottom: 28,
            letterSpacing: '0.04em',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />
            LIVE ON ARC MAINNET
          </div>

          <h1 style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 'clamp(40px, 8vw, 72px)',
            fontWeight: 800,
            color: '#fff',
            letterSpacing: '-0.04em',
            lineHeight: 1.05,
            marginBottom: 24,
          }}>
            Pay. Save. Thrive.
            <br />
            <span style={{ background: 'linear-gradient(90deg, #93c5fd, #c4b5fd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Onchain.
            </span>
          </h1>

          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.8)', lineHeight: 1.65, marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
            BachatPay is India's first USDC payments app on Arc — send money, save toward goals, and run group chit funds onchain. Like GPay, but with real financial sovereignty.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={onEnterApp}
              style={{
                background: '#fff',
                color: '#1d4ed8',
                border: 'none',
                borderRadius: 16,
                padding: '16px 32px',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
                fontFamily: 'Space Grotesk, sans-serif',
              }}
            >
              Launch App <ArrowRight size={18} />
            </button>
            <a
              href={`${EXPLORER_URL}/address/${CONTRACTS[0].address}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 16,
                padding: '16px 32px',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                color: '#fff',
                textDecoration: 'none',
                fontFamily: 'Space Grotesk, sans-serif',
              }}
            >
              View on Explorer <ExternalLink size={16} />
            </a>
          </div>
        </div>

        {/* Scroll hint */}
        <div style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 2, animation: 'bounce 2s ease-in-out infinite' }}>
          <ChevronDown size={24} color="rgba(255,255,255,0.5)" />
        </div>
      </section>

      {/* ── STATS ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: '64px 24px', maxWidth: 900, margin: '0 auto' }}>
        <FadeIn>
          <div style={{
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.8)',
            boxShadow: '0 8px 48px rgba(18,45,69,0.08)',
            borderRadius: 24,
            padding: '40px 32px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 32,
          }}>
            <StatCard value="3" label="Smart Contracts" />
            <StatCard value="$0.10" label="Pay per call" />
            <StatCard value="<0.001¢" label="Gas fee on Arc" />
            <StatCard value="2%" label="Ragequit penalty" />
            <StatCard value="INR" label="Live conversion" />
          </div>
        </FadeIn>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────── */}
      <section style={{ padding: '32px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
        <FadeIn>
          <p style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: '#2563eb', marginBottom: 12, textTransform: 'uppercase' }}>Features</p>
          <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 800, color: '#0f1c35', textAlign: 'center', marginBottom: 48, letterSpacing: '-0.03em' }}>
            Everything you need to handle USDC daily
          </h2>
        </FadeIn>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <FeatureCard
            icon={<Send size={22} color="#fff" />}
            title="Instant Payments"
            desc="Send USDC to any wallet via QR scan or address. Sub-second finality on Arc. Share payment requests via WhatsApp."
            color="linear-gradient(135deg,#2563eb,#1d4ed8)"
            delay={0}
          />
          <FeatureCard
            icon={<QrCode size={22} color="#fff" />}
            title="Merchant QR"
            desc="Shopkeepers generate a QR with a fixed amount. Customers scan and pay instantly — no bank account needed."
            color="linear-gradient(135deg,#0891b2,#0e7490)"
            delay={100}
          />
          <FeatureCard
            icon={<PiggyBank size={22} color="#fff" />}
            title="Bachat Vault"
            desc="Lock USDC toward a savings goal with a target amount and unlock date. Early withdrawal incurs a 2% ragequit penalty."
            color="linear-gradient(135deg,#16a34a,#15803d)"
            delay={200}
          />
          <FeatureCard
            icon={<Users size={22} color="#fff" />}
            title="Chit Fund"
            desc="Start an onchain ROSCA with 2–20 members. Everyone contributes each round; the pooled USDC rotates to one member."
            color="linear-gradient(135deg,#7c3aed,#6d28d9)"
            delay={300}
          />
          <FeatureCard
            icon={<Globe size={22} color="#fff" />}
            title="INR Conversion"
            desc="Live USDC to INR rate from CoinGecko, refreshed every 60 seconds. See your balance and payments in Indian Rupees."
            color="linear-gradient(135deg,#ea580c,#c2410c)"
            delay={400}
          />
          <FeatureCard
            icon={<Zap size={22} color="#fff" />}
            title="Auto Bridge"
            desc="Hold USDC on Base, Arbitrum, or Ethereum? Bridge to Arc automatically using Circle's CCTP and use it immediately."
            color="linear-gradient(135deg,#d97706,#b45309)"
            delay={500}
          />
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────────── */}
      <section style={{ background: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)', padding: '80px 24px' }}>
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' }}>
          <FadeIn>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.6)', marginBottom: 12, textTransform: 'uppercase' }}>How it works</p>
            <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(28px,5vw,40px)', fontWeight: 800, color: '#fff', marginBottom: 48, letterSpacing: '-0.03em' }}>
              Payments as simple as scanning a QR
            </h2>
          </FadeIn>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 24 }}>
            {[
              { step: '01', title: 'Connect Wallet', desc: 'Use MetaMask, Coinbase Wallet, or WalletConnect. Switch to Arc mainnet.' },
              { step: '02', title: 'Get USDC on Arc', desc: 'Bridge from Base, Arbitrum, or Ethereum. Or buy directly with the faucet.' },
              { step: '03', title: 'Scan & Pay', desc: "Scan the merchant's QR code. Approve and send USDC in one tap." },
              { step: '04', title: 'Track & Save', desc: 'View all transactions. Create savings vaults. Join chit fund groups.' },
            ].map(({ step, title, desc }, i) => (
              <FadeIn key={step} delay={i * 100}>
                <div style={{ padding: '28px 20px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.12)', textAlign: 'left' }}>
                  <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', marginBottom: 12 }}>{step}</div>
                  <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>{desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTRACTS ──────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', maxWidth: 700, margin: '0 auto' }}>
        <FadeIn>
          <p style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: '#2563eb', marginBottom: 12, textTransform: 'uppercase' }}>Onchain</p>
          <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(24px,4vw,36px)', fontWeight: 800, color: '#0f1c35', textAlign: 'center', marginBottom: 8, letterSpacing: '-0.02em' }}>
            Deployed on Arc Mainnet
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#6b7c99', marginBottom: 40 }}>Transparent, audited, and immutable. Verify any contract on the Arc explorer.</p>
        </FadeIn>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {CONTRACTS.map(({ name, address }, i) => (
            <FadeIn key={address} delay={i * 80}>
              <div style={{
                background: 'rgba(255,255,255,0.72)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 24px rgba(18,45,69,0.06)',
                borderRadius: 16,
                padding: '16px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 14, color: '#0f1c35' }}>{name}</div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#6b7c99', marginTop: 2 }}>
                      {address.slice(0, 10)}…{address.slice(-8)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => copyAddr(address)}
                    style={{ background: copied === address ? 'rgba(22,163,74,0.1)' : 'rgba(37,99,235,0.08)', border: `1px solid ${copied === address ? 'rgba(22,163,74,0.3)' : 'rgba(37,99,235,0.2)'}`, borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: copied === address ? '#16a34a' : '#2563eb', cursor: 'pointer' }}
                  >
                    {copied === address ? 'Copied!' : 'Copy'}
                  </button>
                  <a
                    href={`${EXPLORER_URL}/address/${address}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#2563eb', cursor: 'pointer', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    Explorer <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ── SECURITY ───────────────────────────────────────────────────────── */}
      <section style={{ padding: '0 24px 80px', maxWidth: 700, margin: '0 auto' }}>
        <FadeIn>
          <div style={{
            background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(124,58,237,0.06))',
            border: '1px solid rgba(37,99,235,0.15)',
            borderRadius: 24,
            padding: '40px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16,
          }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#2563eb,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(37,99,235,0.3)' }}>
              <Shield size={26} color="#fff" />
            </div>
            <h3 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 22, fontWeight: 800, color: '#0f1c35', letterSpacing: '-0.02em' }}>
              Security first
            </h3>
            <p style={{ fontSize: 14, color: '#6b7c99', lineHeight: 1.7, maxWidth: 480 }}>
              All contracts follow the Checks-Effects-Interactions pattern. No upgradeable proxies. No admin backdoors. The BachatVault ragequit penalty and ChitFund rotation are enforced onchain — no trust required.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '0 24px 100px', textAlign: 'center' }}>
        <FadeIn>
          <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(28px,5vw,42px)', fontWeight: 800, color: '#0f1c35', marginBottom: 16, letterSpacing: '-0.03em' }}>
            Ready to go onchain?
          </h2>
          <p style={{ fontSize: 16, color: '#6b7c99', marginBottom: 36 }}>No bank account. No KYC. Just your wallet and USDC.</p>
          <button
            onClick={onEnterApp}
            style={{
              background: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
              color: '#fff',
              border: 'none',
              borderRadius: 18,
              padding: '18px 48px',
              fontSize: 17,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 10,
              boxShadow: '0 12px 40px rgba(29,78,216,0.4)',
              fontFamily: 'Space Grotesk, sans-serif',
              letterSpacing: '-0.01em',
            }}
          >
            Open BachatPay <ArrowRight size={20} />
          </button>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#6b7c99', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
              <ExternalLink size={13} /> View source on GitHub
            </a>
            <a href={APP_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#6b7c99', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
              <ExternalLink size={13} /> {APP_URL.replace('https://', '')}
            </a>
          </div>
        </FadeIn>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid rgba(0,0,0,0.06)',
        padding: '24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, color: '#9ca3af',
      }}>
        <TokenUSDC size={16} />
        <span>BachatPay — Built with <a href="https://studio.arc.io" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Arc Studio</a> on Arc Mainnet</span>
      </footer>

      {/* ── CSS ANIMATIONS ─────────────────────────────────────────────────── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes float1 { 0%,100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-18px) rotate(3deg); } }
        @keyframes float2 { 0%,100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-12px) rotate(-3deg); } }
        @keyframes float3 { 0%,100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-22px) rotate(2deg); } }
        @keyframes bounce { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(8px); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body { -webkit-font-smoothing: antialiased; }
      `}</style>
    </div>
  )
}
