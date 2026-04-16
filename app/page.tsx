'use client';

import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  Crown,
  ChevronRight,
  LogIn,
  Video,
  Zap,
  Sparkles,
  Image as ImageIcon,
  Brain,
  Wand2,
  Layers3,
  Shield,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

export default function HomePage() {
  const [seatsRemaining, setSeatsRemaining] = useState(87);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -250]);

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setSeatsRemaining((prev) => Math.max(0, prev - 1));
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main
      ref={containerRef}
      className="relative min-h-screen overflow-hidden bg-black text-white"
    >
      {/* CINEMATIC GRADIENT BACKGROUND */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/60 via-black to-pink-950/60" />
        <div className="absolute top-0 left-0 h-[1400px] w-[1400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/30 blur-[150px] animate-pulse" />
        <div
          className="absolute right-0 bottom-0 h-[1400px] w-[1400px] translate-x-1/2 translate-y-1/2 rounded-full bg-pink-600/30 blur-[150px] animate-pulse"
          style={{ animationDelay: '2s' }}
        />
        <div
          className="absolute top-1/2 left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/20 blur-[120px] animate-pulse"
          style={{ animationDelay: '4s' }}
        />
      </div>

      {/* ANIMATED PARTICLES */}
      {mounted && (
        <div className="pointer-events-none fixed inset-0 z-0 opacity-30">
          {[...Array(30)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute h-1 w-1 rounded-full bg-white"
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
                ease: 'linear',
              }}
            />
          ))}
        </div>
      )}

      {/* HERO */}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 pt-20 pb-16 sm:px-8">
        <motion.div style={{ y: y1 }} className="mx-auto w-full max-w-7xl">
          <div className="pointer-events-none absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-purple-500/30 via-pink-500/30 to-cyan-500/30 blur-[100px] animate-pulse" />

          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            className="relative mb-8 text-center"
          >
            <motion.div
              animate={{
                scale: [1, 1.02, 1],
                rotate: [0, 0.5, 0],
              }}
              transition={{ duration: 8, repeat: 999999, ease: 'linear' }}
            >
              <h1 className="mb-6 text-7xl leading-none font-black tracking-tighter sm:text-8xl md:text-[10rem] lg:text-[12rem]">
                <span className="relative inline-block">
                  <span
                    className="absolute inset-0 bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent opacity-60 blur-3xl"
                    style={{ WebkitBackgroundClip: 'text' }}
                  >
                    SIRENS
                  </span>
                  <span
                    className="relative bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent"
                    style={{ WebkitBackgroundClip: 'text' }}
                  >
                    SIRENS
                  </span>
                </span>
                <br />
                <span className="relative inline-block">
                  <span
                    className="absolute inset-0 bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent opacity-60 blur-3xl"
                    style={{ WebkitBackgroundClip: 'text' }}
                  >
                    FORGE
                  </span>
                  <span
                    className="relative bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"
                    style={{ WebkitBackgroundClip: 'text' }}
                  >
                    FORGE
                  </span>
                </span>
              </h1>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 1 }}
            className="mb-10 text-center"
          >
            <div className="mb-5 flex items-center justify-center gap-3">
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 4, repeat: 999999, ease: 'linear' }}
              >
                <Sparkles className="h-8 w-8 text-purple-400" />
              </motion.div>
              <h2 className="text-3xl font-medium tracking-wide text-gray-100 sm:text-4xl md:text-5xl">
                Forge Your AI Muse. Create Without Limits.
              </h2>
              <motion.div
                animate={{ rotate: [0, -360] }}
                transition={{ duration: 4, repeat: 999999, ease: 'linear' }}
              >
                <Sparkles className="h-8 w-8 text-pink-400" />
              </motion.div>
            </div>
            <p className="mx-auto max-w-5xl text-lg leading-relaxed font-medium text-gray-300 sm:text-xl md:text-2xl">
              Generate high-end images, shape stronger prompts with Siren&apos;s Mind,
              and build repeatable identity-driven workflows inside one premium creative platform.
            </p>
          </motion.div>

          {/* PRIMARY CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 1 }}
            className="relative z-20 mb-5 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <motion.div whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.98 }}>
              <div className="group relative">
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-60 blur-xl transition-opacity group-hover:opacity-100" />
                <Link
                  href="/pricing"
                  className="relative flex min-w-[250px] items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 px-8 py-5 text-lg font-semibold text-white shadow-lg transition-all hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                >
                  <Zap className="h-5 w-5" />
                  View Pricing
                  <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </motion.div>

            <motion.div whileHover={{ scale: 1.05, y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/login"
                className="group relative flex min-w-[250px] items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-8 py-5 text-lg font-semibold text-white shadow-lg backdrop-blur-xl transition-all hover:border-white/30 hover:bg-white/20"
              >
                <LogIn className="h-5 w-5" />
                Login
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          </motion.div>

          {/* SECONDARY CTA */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 1 }}
            className="relative z-20 mb-14 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                href="/terms"
                className="group relative flex min-w-[220px] items-center justify-center gap-3 rounded-2xl border border-white/15 bg-black/30 px-8 py-4 text-base font-semibold text-white transition-all hover:border-white/25 hover:bg-white/5"
              >
                <Shield className="h-5 w-5" />
                Review Terms
                <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          </motion.div>

          {/* WHAT UNLOCKS INSIDE */}
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.72, duration: 1 }}
            className="relative z-10 mx-auto mb-16 max-w-5xl px-4"
          >
            <div className="overflow-hidden rounded-[30px] border border-white/15 bg-gradient-to-br from-white/10 to-white/5 p-6 backdrop-blur-xl sm:p-8">
              <div className="mb-6 text-center">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                  What Unlocks Inside
                </p>
                <h3 className="text-2xl font-bold text-white sm:text-3xl">
                  Two core workflows power the platform
                </h3>
                <p className="mx-auto mt-3 max-w-3xl text-base leading-relaxed font-medium text-gray-300">
                  After login and active access, members can start with guided prompt-building in Siren&apos;s Mind or jump straight into Generator for direct creation.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="relative overflow-hidden rounded-3xl border border-purple-400/20 bg-gradient-to-br from-purple-950/40 via-black/40 to-cyan-950/20 p-6">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                    <Brain className="h-7 w-7 text-white" />
                  </div>
                  <h4 className="mb-2 text-xl font-bold text-white">
                    Siren&apos;s Mind
                  </h4>
                  <p className="text-base leading-relaxed font-medium text-gray-300">
                    Guided prompt creation for brainstorming, refining mood, sharpening concepts, and turning rough ideas into stronger output direction.
                  </p>
                </div>

                <div className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-950/20 via-black/40 to-purple-950/30 p-6">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
                    <Wand2 className="h-7 w-7 text-white" />
                  </div>
                  <h4 className="mb-2 text-xl font-bold text-white">
                    Generator
                  </h4>
                  <p className="text-base leading-relaxed font-medium text-gray-300">
                    Direct creation workflow for members who already know what they want and want to jump straight into image generation and control settings.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* QUICK CLARITY */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 1 }}
            className="mx-auto mb-20 grid max-w-5xl grid-cols-1 gap-4 px-4 md:grid-cols-3"
          >
            {[
              {
                icon: Wand2,
                title: 'Create without a LoRA',
                desc: 'Start generating immediately. Identity training is optional, not required.',
                gradient: 'from-purple-500 to-pink-500',
              },
              {
                icon: Brain,
                title: 'Use Siren’s Mind first',
                desc: 'Turn rough ideas into stronger prompts before you ever hit generate.',
                gradient: 'from-pink-500 to-cyan-500',
              },
              {
                icon: Layers3,
                title: 'Build consistency later',
                desc: 'Train identities and scale into repeatable creative control when you are ready.',
                gradient: 'from-cyan-500 to-blue-500',
              },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 + index * 0.1 }}
                className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/10 to-white/5 p-6 backdrop-blur-xl"
              >
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${item.gradient} shadow-lg`}
                >
                  <item.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">{item.title}</h3>
                <p className="text-base leading-relaxed font-medium text-gray-300">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* FEATURE CARDS */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.95, duration: 1 }}
            className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 md:grid-cols-3"
          >
            {[
              {
                icon: ImageIcon,
                title: 'High-End Image Generation',
                desc: 'Prompt-driven creation built for premium visuals, stronger control, and identity-aware direction.',
                gradient: 'from-purple-500 to-pink-500',
              },
              {
                icon: Brain,
                title: 'Guided Prompt Intelligence',
                desc: 'Siren’s Mind helps creators sharpen mood, character, scene, and output intent before generation.',
                gradient: 'from-pink-500 to-cyan-500',
              },
              {
                icon: Video,
                title: 'Video-Ready Direction',
                desc: 'The frontend is being shaped for image now and stronger cinematic workflows as compute scales back online.',
                gradient: 'from-cyan-500 to-blue-500',
              },
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.05 + index * 0.15 }}
                whileHover={{ scale: 1.05, y: -10 }}
                className="group relative"
              >
                <div
                  className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${feature.gradient} opacity-20 blur-2xl transition-opacity group-hover:opacity-40`}
                />
                <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-white/10 to-white/5 p-8 backdrop-blur-xl transition-all hover:border-white/40">
                  <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-gradient-to-br from-white/10 to-transparent blur-2xl" />
                  <div
                    className={`mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${feature.gradient} shadow-lg transition-transform group-hover:scale-110`}
                  >
                    <feature.icon className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="mb-2 text-2xl font-bold text-white">{feature.title}</h3>
                  <p className="text-base leading-relaxed font-medium text-gray-300">{feature.desc}</p>
                  <div className="absolute right-0 bottom-0 left-0 h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* HOW IT WORKS / ENTRY PATH */}
      <motion.section style={{ y: y2 }} className="relative z-10 px-4 py-24">
        <div className="mx-auto max-w-6xl space-y-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h2 className="mb-4 text-5xl font-black tracking-tight sm:text-6xl md:text-7xl">
              <span
                className="bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent"
                style={{ WebkitBackgroundClip: 'text' }}
              >
                How It Works
              </span>
            </h2>
            <p className="text-xl font-medium text-gray-300">
              Start guided or go direct. Identity is optional, not required.
            </p>
          </motion.div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                number: '01',
                title: 'Choose your path',
                desc: 'Start with Siren’s Mind for guided prompt building or jump straight into Generator.',
              },
              {
                number: '02',
                title: 'Describe what you want',
                desc: 'Mood, scene, character, style, or polished concept — the workflow starts with intent.',
              },
              {
                number: '03',
                title: 'Generate now',
                desc: 'Create without a LoRA, or select an identity when you want stronger repeatability.',
              },
              {
                number: '04',
                title: 'Scale into identity',
                desc: 'Train identities later and build toward more advanced, controlled creative output.',
              },
            ].map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: index * 0.08 }}
                className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
              >
                <div className="mb-4 text-sm font-bold tracking-[0.28em] text-cyan-300">
                  {step.number}
                </div>
                <h3 className="mb-3 text-xl font-semibold text-white">{step.title}</h3>
                <p className="text-base leading-relaxed font-medium text-gray-300">{step.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* PRICING PREVIEW */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="space-y-10"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="relative group">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-yellow-500/20 to-orange-500/20 blur-3xl opacity-50 transition-opacity group-hover:opacity-70" />
                <div className="relative rounded-3xl border border-yellow-500/30 bg-gradient-to-br from-yellow-950/30 via-black/90 to-orange-950/30 p-8 backdrop-blur-xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg shadow-yellow-500/40">
                      <Crown className="h-7 w-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold text-yellow-300">OG Founder</h3>
                      <p className="text-sm font-medium text-yellow-300/90">Elite early access tier</p>
                    </div>
                  </div>

                  <div className="mb-6 inline-flex rounded-full bg-gradient-to-r from-red-600 to-red-700 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/40">
                    10 OF 35 LEFT
                  </div>

                  <p className="mb-4 text-lg leading-relaxed font-medium text-gray-300">
                    Lock in the strongest early positioning, premium affiliate benefits, and your highest-value seat inside the platform.
                  </p>

                  <p className="mb-6 text-sm leading-relaxed font-medium text-yellow-100/85">
                    Includes the strongest affiliate upside, lifetime founder status, and locked-in lifetime access.
                  </p>

                  <div className="mb-6 flex items-baseline gap-2">
                    <span className="text-6xl font-bold text-yellow-300">$1,333</span>
                    <span className="text-xl font-medium text-gray-300">one-time</span>
                  </div>

                  <Link
                    href="/pricing"
                    className="group inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-yellow-500 to-orange-500 px-6 py-4 text-lg font-semibold text-black transition-all hover:from-yellow-400 hover:to-orange-400"
                  >
                    View Full Pricing
                    <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-green-500/20 to-emerald-500/20 blur-3xl opacity-50 transition-opacity group-hover:opacity-70" />
                <div className="relative rounded-3xl border border-green-500/30 bg-gradient-to-br from-green-950/30 via-black/90 to-emerald-950/30 p-8 backdrop-blur-xl">
                  <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 shadow-lg shadow-green-500/40">
                      <Zap className="h-7 w-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold text-green-300">Early Bird</h3>
                      <p className="text-sm font-medium text-green-300/90">Subscription tier</p>
                    </div>
                  </div>

                  {mounted && (
                    <div className="mb-6 inline-flex rounded-full bg-gradient-to-r from-red-600 to-red-700 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/40">
                      {seatsRemaining}/120 LEFT
                    </div>
                  )}

                  <p className="mb-4 text-lg leading-relaxed font-medium text-gray-300">
                    Enter the platform now with live subscription access and grow into stronger image, prompt, and identity workflows.
                  </p>

                  <p className="mb-6 text-sm leading-relaxed font-medium text-green-100/85">
                    Includes recurring platform access, affiliate earning potential, and creator status perks.
                  </p>

                  <div className="mb-6 flex items-baseline gap-2">
                    <span className="text-6xl font-bold text-green-300">$29.99</span>
                    <span className="text-xl font-medium text-gray-300">/month</span>
                  </div>

                  <Link
                    href="/pricing"
                    className="group inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-4 text-lg font-semibold text-white transition-all hover:from-green-400 hover:to-emerald-400"
                  >
                    Explore Pricing
                    <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            </div>

            {/* AFFILIATE HINT */}
            <div className="mx-auto max-w-4xl rounded-3xl border border-white/15 bg-gradient-to-br from-white/10 to-white/5 p-6 text-center backdrop-blur-xl sm:p-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                Creator Upside Built In
              </p>
              <h3 className="text-2xl font-bold text-white sm:text-3xl">
                More than access
              </h3>
              <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed font-medium text-gray-300">
                Both tiers include affiliate earning potential, creator status perks, and long-term upside inside the platform.
              </p>
              <p className="mt-3 text-sm font-medium text-gray-400">
                Founder tier unlocks the strongest commission structure and lifetime positioning. Full details are on the pricing page.
              </p>
              <div className="mt-6">
                <Link
                  href="/pricing"
                  className="group inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
                >
                  View commission details
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.section>
    </main>
  );
}