'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, Zap, Crown, Users, TrendingUp, ChevronRight, Check, Infinity } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function HomePage() {
  const [seatsRemaining, setSeatsRemaining] = useState(87);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeatsRemaining(prev => Math.max(0, prev - 1));
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  const earlyBirdFeatures = [
    "10–15 second video generation",
    "AI Image Generator (SDXL + Custom LoRA)",
    "Face Reference Uploads",
    "SFW, NSFW, and Cinematic modes",
    "Dashboard to store all generations",
    "Infinite tokens at launch",
    "Auto-post empire tools (Phase 2)"
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-purple-900 via-black to-pink-900 text-white flex flex-col items-center justify-center p-4 sm:p-8 relative overflow-hidden">

      {/* Decorative Blurs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-purple-600 rounded-full filter blur-3xl opacity-30 animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-pink-600 rounded-full filter blur-3xl opacity-30 animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-600 rounded-full filter blur-3xl opacity-20 animate-pulse pointer-events-none" style={{ animationDelay: '2s' }} />

      {/* HERO */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 text-center mb-12"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
          className="inline-block mb-6"
        >
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-[0_0_60px_rgba(147,51,234,0.8)]">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-6xl sm:text-7xl md:text-8xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400"
        >
          SIRENS FORGE
        </motion.h1>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="text-xl sm:text-2xl md:text-4xl font-semibold mb-6 text-gray-200"
        >
          Build Your AI Siren in Seconds
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="text-base sm:text-lg md:text-xl mb-12 max-w-2xl mx-auto text-gray-300 leading-relaxed px-4"
        >
          Generate ultra-realistic AI influencers with your own face references.
          Create SFW, NSFW, and cinematic scenes instantly.
          Unlimited generations for all tiers. Video generation at launch.
        </motion.p>
      </motion.div>

      {/* OG FOUNDER PACKAGE */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7 }}
        className="relative z-10 max-w-2xl w-full mb-12 px-4"
      >
        <div className="relative bg-gradient-to-br from-yellow-900/30 via-black/50 to-yellow-900/30 backdrop-blur-xl border-2 border-yellow-500/50 rounded-3xl p-6 sm:p-8 shadow-[0_0_60px_rgba(234,179,8,0.4)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/10 via-yellow-300/10 to-yellow-500/10 pointer-events-none animate-pulse" />

          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Crown className="w-8 h-8 text-yellow-400" />
              <h3 className="text-2xl sm:text-3xl font-bold text-yellow-300 text-center">
                OG FOUNDER PACKAGE
              </h3>
            </div>

            <div className="inline-block bg-red-600 text-white text-xs sm:text-sm font-bold px-4 py-1 rounded-full mb-4 mx-auto block w-fit animate-pulse">
              ⚡ ONLY 10 PACKAGES LEFT
            </div>

            <p className="text-gray-300 mb-6 text-center text-sm sm:text-base">
              Secure one of the final <strong className="text-yellow-300">OG Founder Slots</strong> and lock in elite lifetime benefits.
            </p>

            {/* OG BENEFITS */}
            <div className="bg-black/40 rounded-2xl p-6 mb-6 border border-yellow-500/30">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-6 h-6 text-yellow-400" />
                <h4 className="text-lg font-bold text-yellow-300">OG Founder Benefits</h4>
              </div>

              <div className="space-y-3">
                
                {/* Video Length Benefit */}
                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-yellow-300">15–20 second video generation</strong> at launch
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    Unlimited image & video generations
                  </span>
                </div>

                {/* Affiliate Program */}
                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-yellow-300">50% commission</strong> on all subscription referrals (first 6 months)
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-yellow-300">25% lifetime commission</strong> on all subscriptions afterward
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-yellow-300">25% one-time commission</strong> on all one-time purchases
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Infinity className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    Lifetime Founder Badge & platform recognition
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-yellow-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    Free access to future tools (Muse Store, Builder, Autoposting)
                  </span>
                </div>
              </div>
            </div>

            {/* OG PRICE + CTA */}
            <div className="text-center mb-6">
              <p className="text-2xl sm:text-3xl font-bold text-yellow-300 mb-2">
                $1,333.33
              </p>
              <p className="text-sm text-gray-400">One Time Founder Access</p>
              <p className="text-xs text-yellow-500 mt-2">Must use referral code to earn commissions</p>
            </div>

            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Link
                href="/og"
                className="group flex items-center justify-center gap-2 w-full px-8 py-4 bg-gradient-to-r from-yellow-400 to-yellow-600 text-black font-bold text-base sm:text-lg rounded-full hover:from-yellow-500 hover:to-yellow-700 transition-all shadow-[0_0_40px_rgba(234,179,8,0.6)]"
              >
                <Crown className="w-5 h-5" />
                CLAIM OG PACKAGE
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>

          </div>
        </div>
      </motion.div>

      {/* EARLY BIRD ACCESS */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8 }}
        className="relative z-10 max-w-2xl w-full mb-12 px-4"
      >
        <div className="relative bg-gradient-to-br from-green-900/30 via-black/50 to-emerald-900/30 backdrop-blur-xl border-2 border-green-500/50 rounded-3xl p-6 sm:p-8 shadow-[0_0_60px_rgba(34,197,94,0.4)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 via-emerald-300/10 to-green-500/10 pointer-events-none animate-pulse" />

          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Zap className="w-8 h-8 text-green-400" />
              <h3 className="text-2xl sm:text-3xl font-bold text-green-300 text-center">
                EARLY BIRD ACCESS
              </h3>
            </div>

            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="bg-red-600 text-white text-sm sm:text-base font-bold px-4 py-2 rounded-full animate-pulse">
                {seatsRemaining}/120 SEATS LEFT
              </div>
            </div>

            {/* EARLY BIRD PRICE */}
            <div className="text-center mb-6">
              <p className="text-3xl sm:text-4xl font-bold text-green-300 mb-2">
                $29.99<span className="text-lg text-gray-400">/mo</span>
              </p>
              <p className="text-sm text-gray-400">First 120 Members Only</p>
            </div>

            {/* EARLY BIRD FEATURES */}
            <div className="grid gap-3 mb-6">
              {earlyBirdFeatures.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + index * 0.1 }}
                  className="flex items-start gap-3 text-gray-300"
                >
                  <Check className="w-5 h-5 text-green-400 mt-0.5" />
                  <span className="text-sm sm:text-base">{feature}</span>
                </motion.div>
              ))}
            </div>

            {/* EARLY BIRD AFFILIATE PROGRAM */}
            <div className="bg-black/40 rounded-2xl p-6 mb-6 border border-green-500/30">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-6 h-6 text-green-400" />
                <h4 className="text-lg font-bold text-green-300">Early Bird Affiliate Program</h4>
              </div>
              <div className="space-y-3">

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-green-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-green-300">20% lifetime commission</strong> on subscription referrals (first 6 months)
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Check className="w-5 h-5 text-green-400 mt-0.5" />
                  <span className="text-sm sm:text-base">
                    <strong className="text-green-300">10% one-time commission</strong> on all one-time purchases (first 6 months)
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300">
                  <Crown className="w-5 h-5 text-green-400 mt-0.5" />
                  <span className="text-sm sm:text-base">Crowned forever in the platform</span>
                </div>

              </div>

              <p className="text-xs text-green-500 mt-4 text-center">
                Must use referral code to earn commissions
              </p>
            </div>

            {/* EARLY BIRD CTA */}
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Link
                href="/enroll"
                className="group flex items-center justify-center gap-2 w-full px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-base sm:text-lg rounded-full hover:from-green-600 hover:to-emerald-700 transition-all shadow-[0_0_40px_rgba(34,197,94,0.6)]"
              >
                <Zap className="w-5 h-5" />
                CLAIM EARLY BIRD
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>

          </div>
        </div>
      </motion.div>

      {/* FUTURE PRICING */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.0 }}
        className="relative z-10 max-w-3xl w-full mb-12 px-4"
      >
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8">
          <h3 className="text-xl sm:text-2xl font-bold text-center mb-6 text-white">
            Future Pricing Tiers
          </h3>

          <div className="space-y-6">

            {/* PRIME ACCESS */}
            <div className="bg-black/40 rounded-2xl p-6 border border-purple-500/30">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-bold text-purple-300">Prime Access</h4>
                <span className="text-2xl font-bold text-purple-300">
                  $59.99<span className="text-sm text-gray-400">/mo</span>
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-4">After 120 seats sell (Seats 121–200)</p>

              <div className="space-y-2">

                <div className="flex items-start gap-3 text-gray-300 text-sm">
                  <Check className="w-4 h-4 text-purple-400 mt-0.5" />
                  <span>
                    <strong className="text-purple-300">10% lifetime commission</strong> on subscription referrals (first 6 months)
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300 text-sm">
                  <Check className="w-4 h-4 text-purple-400 mt-0.5" />
                  <span>
                    <strong className="text-purple-300">7.5% one-time commission</strong> on all one-time purchases (first 6 months)
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300 text-sm">
                  <Infinity className="w-4 h-4 text-purple-400 mt-0.5" />
                  <span>Unlimited generations · crowned forever</span>
                </div>

              </div>
            </div>

            {/* STANDARD ACCESS */}
            <div className="bg-black/40 rounded-2xl p-6 border border-gray-500/30">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-bold text-gray-300">Standard Access</h4>
                <span className="text-2xl font-bold text-gray-300">
                  $79.99<span className="text-sm text-gray-400">/mo</span>
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-4">After 200 total seats sell (Seat 201+)</p>

              <div className="space-y-2">

                <div className="flex items-start gap-3 text-gray-300 text-sm">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5" />
                  <span>
                    <strong className="text-gray-300">5% flat commission</strong> on subscriptions + all one-time purchases
                  </span>
                </div>

                <div className="flex items-start gap-3 text-gray-300 text-sm">
                  <Infinity className="w-4 h-4 text-gray-400 mt-0.5" />
                  <span>Unlimited generations · full platform access</span>
                </div>

              </div>
            </div>

          </div>
        </div>
      </motion.div>

      {/* PHASE 2 TEASER */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1 }}
        className="relative z-10 max-w-2xl w-full px-4 text-center mb-12"
      >
        <div className="bg-white/5 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-6">
          <p className="text-sm text-gray-400">
            <span className="text-cyan-300 font-semibold">Coming in Phase 2:</span>
            <br />
            Muse Store, Custom Muse Builder, Autoposting Engine, Vault Stacking, and Advanced Tools.
          </p>
        </div>
      </motion.div>

    </main>
  );
}
