'use client';

import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Crown, Users, TrendingUp, ChevronRight, Check, Infinity, LogIn, UserPlus, Video, Zap, Sparkles, Image as ImageIcon, Coins } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

export default function HomePage() {
  const [seatsRemaining, setSeatsRemaining] = useState(87);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"]
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -400]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setSeatsRemaining(prev => Math.max(0, prev - 1));
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main ref={containerRef} className="min-h-screen bg-black text-white overflow-hidden relative">
      
      {/* CINEMATIC GRADIENT BACKGROUND */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 w-[1400px] h-[1400px] bg-purple-600/30 rounded-full blur-[150px] -translate-x-1/2 -translate-y-1/2 animate-pulse" />
        <div className="absolute bottom-0 right-0 w-[1400px] h-[1400px] bg-pink-600/30 rounded-full blur-[150px] translate-x-1/2 translate-y-1/2 animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-cyan-600/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '4s' }} />
      </div>

      {/* ANIMATED PARTICLES - FIXED */}
      {mounted && (
        <div className="fixed inset-0 z-0 opacity-30 pointer-events-none">
          {[...Array(30)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-white rounded-full"
              style={{
                left: `${(i * 3.33) % 100}%`,
                top: `${(i * 7) % 100}%`,
              }}
              animate={{
                y: [0, -100, 0],
                opacity: [0, 1, 0],
              }}
              transition={{
                duration: 3 + (i % 3),
                repeat: 999999,
                delay: i * 0.2,
                ease: "linear"
              }}
            />
          ))}
        </div>
      )}

      {/* HERO SECTION WITH PARALLAX */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 pt-20">
        <motion.div style={{ y: y1, opacity }} className="max-w-7xl mx-auto w-full">
          
          {/* GLOWING ORB BEHIND TITLE */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-purple-500/30 via-pink-500/30 to-cyan-500/30 rounded-full blur-[100px] animate-pulse" />
          
          {/* MAIN TITLE WITH GLOW */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="text-center mb-12 relative"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.02, 1],
                rotate: [0, 0.5, 0]
              }}
              transition={{ duration: 8, repeat: 999999, ease: "linear" }}
            >
              <h1 className="text-8xl sm:text-9xl md:text-[12rem] lg:text-[14rem] font-black mb-6 tracking-tighter leading-none">
                <span className="relative inline-block">
                  <span className="absolute inset-0 blur-3xl bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent opacity-60" style={{ WebkitBackgroundClip: 'text' }}>
                    SIRENS
                  </span>
                  <span className="relative bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent" style={{ WebkitBackgroundClip: 'text' }}>
                    SIRENS
                  </span>
                </span>
                <br />
                <span className="relative inline-block">
                  <span className="absolute inset-0 blur-3xl bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent opacity-60" style={{ WebkitBackgroundClip: 'text' }}>
                    FORGE
                  </span>
                  <span className="relative bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent" style={{ WebkitBackgroundClip: 'text' }}>
                    FORGE
                  </span>
                </span>
              </h1>
            </motion.div>
          </motion.div>

          {/* SUBTITLE WITH SPARKLE */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 1 }}
            className="text-center mb-16"
          >
            <div className="flex items-center justify-center gap-3 mb-6">
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 4, repeat: 999999, ease: "linear" }}
              >
                <Sparkles className="w-8 h-8 text-purple-400" />
              </motion.div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-gray-200 tracking-wide">
                Professional AI Content Generation
              </h2>
              <motion.div
                animate={{ rotate: [0, -360] }}
                transition={{ duration: 4, repeat: 999999, ease: "linear" }}
              >
                <Sparkles className="w-8 h-8 text-pink-400" />
              </motion.div>
            </div>
            <p className="text-xl sm:text-2xl max-w-3xl mx-auto text-gray-400 leading-relaxed font-light">
              Create ultra-realistic AI models with unlimited generation power
            </p>
          </motion.div>

          {/* CTA BUTTONS */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 1 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-24"
          >
            <motion.div 
              whileHover={{ scale: 1.05, y: -2 }} 
              whileTap={{ scale: 0.98 }}
            >
              <Link
                href="/login"
                className="group flex items-center justify-center gap-3 px-12 py-5 bg-white/10 backdrop-blur-xl border border-white/20 text-white font-semibold text-lg rounded-2xl hover:bg-white/20 hover:border-white/30 transition-all shadow-lg shadow-white/5 min-w-[220px]"
              >
                <LogIn className="w-5 h-5" />
                Login
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.05, y: -2 }} 
              whileTap={{ scale: 0.98 }}
            >
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                <Link
                  href="/signup"
                  className="relative flex items-center justify-center gap-3 px-12 py-5 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white font-semibold text-lg rounded-2xl hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 transition-all shadow-lg min-w-[220px]"
                >
                  <UserPlus className="w-5 h-5" />
                  Get Started
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </motion.div>
          </motion.div>

          {/* PREMIUM FEATURE CARDS */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 1 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto px-4"
          >
            {[
              {
                icon: ImageIcon,
                title: "Unlimited Images",
                desc: "SDXL + Custom LoRA",
                gradient: "from-purple-500 to-pink-500",
              },
              {
                icon: Coins,
                title: "Unlimited Tokens",
                desc: "Never run out of credits",
                gradient: "from-yellow-500 to-orange-500",
              },
              {
                icon: Video,
                title: "AI Video",
                desc: "10-15 sec at launch",
                gradient: "from-cyan-500 to-blue-500",
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9 + index * 0.15 }}
                whileHover={{ scale: 1.05, y: -10 }}
                className="relative group"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} rounded-3xl blur-2xl opacity-20 group-hover:opacity-40 transition-opacity`} />
                <div className="relative bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/20 rounded-3xl p-8 hover:border-white/40 transition-all overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/10 to-transparent rounded-full blur-2xl" />
                  
                  <div className={`w-16 h-16 mb-6 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                    <feature.icon className="w-8 h-8 text-white" />
                  </div>
                  
                  <h3 className="text-2xl font-bold mb-2 text-white">{feature.title}</h3>
                  <p className="text-gray-400 font-light leading-relaxed">{feature.desc}</p>
                  
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* PRICING SECTIONS WITH PARALLAX */}
      <motion.section style={{ y: y2 }} className="relative z-10 py-32 px-4">
        <div className="max-w-6xl mx-auto space-y-20">
          
          {/* SECTION HEADER */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-6xl sm:text-7xl md:text-8xl font-black mb-4 tracking-tight">
              <span className="bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent" style={{ WebkitBackgroundClip: 'text' }}>
                Pricing
              </span>
            </h2>
            <p className="text-xl text-gray-400 font-light">Lock in early access pricing</p>
          </motion.div>

          {/* OG FOUNDER PACKAGE */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl mx-auto"
          >
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/30 to-orange-500/30 rounded-3xl blur-3xl opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative bg-gradient-to-br from-yellow-950/40 via-black/90 to-orange-950/40 backdrop-blur-xl border border-yellow-500/40 rounded-3xl p-10 sm:p-12 overflow-hidden">
                
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-yellow-500/20 to-transparent rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/50">
                        <Crown className="w-7 h-7 text-white" />
                      </div>
                      <h3 className="text-4xl sm:text-5xl font-bold text-yellow-300">
                        OG Founder
                      </h3>
                    </div>
                    <div className="bg-gradient-to-r from-red-600 to-red-700 text-white text-sm font-bold px-6 py-2 rounded-full shadow-lg shadow-red-500/50">
                      10 OF 35 LEFT
                    </div>
                  </div>

                  <p className="text-gray-300 mb-8 text-lg font-light leading-relaxed">
                    Secure one of the final OG Founder slots and lock in elite affiliate benefits for life.
                  </p>

                  <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-8 mb-8 border border-yellow-500/30">
                    <div className="flex items-center gap-3 mb-6">
                      <TrendingUp className="w-6 h-6 text-yellow-400" />
                      <h4 className="text-xl font-semibold text-yellow-300">Affiliate Program</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">50% commission</strong> on subscription referrals (first 6 months)
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">25% lifetime commission</strong> after 6 months
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">25% commission</strong> on one-time purchases
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Infinity className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">Lifetime recognition in platform</span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Video className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">15-20 second AI videos</strong> (vs 10-15 sec)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-center gap-2 mb-8">
                    <span className="text-7xl font-bold text-yellow-300">$1,333</span>
                    <span className="text-2xl text-gray-400 font-light">one-time</span>
                  </div>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                      <Link
                        href="/signup?tier=og"
                        className="relative flex items-center justify-center gap-3 w-full px-10 py-5 bg-gradient-to-r from-yellow-500 to-orange-500 text-black font-semibold text-xl rounded-2xl hover:from-yellow-400 hover:to-orange-400 transition-all shadow-lg"
                      >
                        <Crown className="w-6 h-6" />
                        Claim OG Package
                        <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </div>
                  </motion.div>

                  <p className="text-center text-sm text-yellow-500/80 mt-4 font-light">
                    Must use referral code to earn commissions
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* EARLY BIRD PACKAGE */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl mx-auto"
          >
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-green-500/30 to-emerald-500/30 rounded-3xl blur-3xl opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative bg-gradient-to-br from-green-950/40 via-black/90 to-emerald-950/40 backdrop-blur-xl border border-green-500/40 rounded-3xl p-10 sm:p-12 overflow-hidden">
                
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-green-500/20 to-transparent rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/50">
                        <Zap className="w-7 h-7 text-white" />
                      </div>
                      <h3 className="text-4xl sm:text-5xl font-bold text-green-300">
                        Early Bird
                      </h3>
                    </div>
                    {mounted && (
                      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white text-sm font-bold px-6 py-2 rounded-full shadow-lg shadow-red-500/50">
                        {seatsRemaining}/120 LEFT
                      </div>
                    )}
                  </div>

                  <div className="flex items-baseline justify-center gap-2 mb-8">
                    <span className="text-7xl font-bold text-green-300">$29.99</span>
                    <span className="text-2xl text-gray-400 font-light">/month</span>
                  </div>

                  <div className="grid gap-4 mb-8">
                    {[
                      "Unlimited AI image generation (SDXL + Custom LoRA)",
                      "Unlimited tokens at launch",
                      "10-15 second AI video generation at launch",
                      "Face reference uploads",
                      "SFW, NSFW, and Cinematic modes",
                      "Dashboard to store all generations"
                    ].map((feature, i) => (
                      <div key={i} className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">{feature}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-8 mb-8 border border-green-500/30">
                    <div className="flex items-center gap-3 mb-6">
                      <Users className="w-6 h-6 text-green-400" />
                      <h4 className="text-xl font-semibold text-green-300">Affiliate Program</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">20% commission</strong> (first 6 months)
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">10% lifetime commission</strong> after 6 months
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">
                          <strong className="font-semibold">10% commission</strong> on one-time purchases
                        </span>
                      </div>
                      <div className="flex items-start gap-3 text-gray-300">
                        <Crown className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="font-light">Crowned forever in platform</span>
                      </div>
                    </div>
                    <p className="text-sm text-green-500/80 mt-6 text-center font-light">
                      Must use referral code to earn commissions
                    </p>
                  </div>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-500 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                      <Link
                        href="/signup?tier=early"
                        className="relative flex items-center justify-center gap-3 w-full px-10 py-5 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold text-xl rounded-2xl hover:from-green-400 hover:to-emerald-400 transition-all shadow-lg"
                      >
                        <Zap className="w-6 h-6" />
                        Claim Early Bird
                        <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </div>
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* FUTURE PRICING */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="max-w-5xl mx-auto"
          >
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-10">
              <h3 className="text-3xl font-bold text-center mb-10 text-white">
                Future Pricing
              </h3>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-black/40 rounded-2xl p-8 border border-purple-500/20">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-2xl font-semibold text-purple-300">Prime</h4>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-purple-300">$59.99</div>
                      <div className="text-sm text-gray-400 font-light">/month</div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mb-6 font-light">Seats 121-200</p>
                  <div className="space-y-3 text-sm text-gray-300">
                    <div className="flex gap-3"><Check className="w-5 h-5 text-purple-400 flex-shrink-0" /><span className="font-light">10% commission (6 months)</span></div>
                    <div className="flex gap-3"><Check className="w-5 h-5 text-purple-400 flex-shrink-0" /><span className="font-light">7.5% lifetime after</span></div>
                  </div>
                </div>

                <div className="bg-black/40 rounded-2xl p-8 border border-gray-500/20">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-2xl font-semibold text-gray-300">Standard</h4>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-gray-300">$79.99</div>
                      <div className="text-sm text-gray-400 font-light">/month</div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mb-6 font-light">Seat 201+</p>
                  <div className="space-y-3 text-sm text-gray-300">
                    <div className="flex gap-3"><Check className="w-5 h-5 text-gray-400 flex-shrink-0" /><span className="font-light">5% commission (6 months)</span></div>
                    <div className="flex gap-3"><Check className="w-5 h-5 text-gray-400 flex-shrink-0" /><span className="font-light">Full platform access</span></div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* PHASE 2 TEASER */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="max-w-3xl mx-auto text-center"
          >
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-3xl blur-2xl opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative bg-cyan-900/20 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-8">
                <h3 className="text-2xl font-semibold text-cyan-300 mb-4">
                  Phase 2 — Coming Q1/Q2 2026
                </h3>
                <p className="text-lg text-gray-400 font-light leading-relaxed">
                  Muse Store · Custom Muse Builder · Vault Stacking · Advanced Tools · Auto-Post Engine
                </p>
              </div>
            </div>
          </motion.div>

        </div>
      </motion.section>

      {/* FOOTER */}
      <footer className="relative z-10 border-t border-white/10 py-8 text-center text-gray-500">
        <p className="font-light">© 2025 SirensForge. All rights reserved.</p>
      </footer>

    </main>
  );
}

// END OF FILE
