"use client"

import React, { useEffect, useState } from "react"
import { supabaseBrowser } from "@/lib/supabase"
import { LoginAuthFlow, type LoginAuthState } from "@/lib/payment-v2/loginAuthFlow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkles, Eye, EyeOff, Crown, Star } from "lucide-react"
import { motion } from "framer-motion"

type LoginClientProps = {
  initialMode: "login" | "signup"
  continuation: string | null
  authError: string | null
  callbackUrl: string | null
}

export default function LoginClient({ initialMode, continuation, authError, callbackUrl }: LoginClientProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [supabase] = useState(() => supabaseBrowser())
  const [flow] = useState(() => new LoginAuthFlow(initialMode, continuation, callbackUrl, authError, {
    getUser: () => supabase.auth.getUser(),
    passwordLogin: (loginEmail, loginPassword) => supabase.auth.signInWithPassword({
      email: loginEmail, password: loginPassword,
    }),
    signup: (signupEmail, signupPassword, emailRedirectTo) => supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    }),
    startOAuth: (provider, redirectTo) => supabase.auth.signInWithOAuth({
      provider, options: { redirectTo },
    }),
    subscribeAuthState: (callback) => {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(() => callback())
      return () => subscription.unsubscribe()
    },
    navigate: (destination) => window.location.replace(destination),
  }))
  const [authState, setAuthState] = useState<LoginAuthState>({
    mode: initialMode,
    checkingSession: true,
    submitting: false,
    oauthBusy: false,
    checkEmail: false,
    error: authError,
  })

  useEffect(() => {
    const unsubscribeState = flow.subscribe(setAuthState)
    flow.start()
    return () => {
      unsubscribeState()
      flow.dispose()
    }
  }, [flow])

  useEffect(() => {
    flow.updateServerValues(continuation, callbackUrl)
  }, [flow, continuation, callbackUrl])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (authState.mode === "login") void flow.passwordLogin(email, password)
    else void flow.signup(email, password)
  }
  const handleGoogleLogin = () => void flow.startOAuth("google")
  const handleDiscordLogin = () => void flow.startOAuth("discord")
  const { mode, checkingSession, submitting: isLoading, oauthBusy, checkEmail, error } = authState

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-sm text-gray-300">Checking your session...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="hidden lg:block space-y-8"
        >
          <h1 className="text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            SirensForge
          </h1>

          <p className="text-2xl text-gray-300">AI-Powered Media Generation</p>
          <p className="text-lg text-gray-400">
            Create stunning images and videos with identity-first AI technology
          </p>

          <div className="space-y-4">
            <Feature
              icon={<Sparkles className="w-6 h-6 text-purple-400" />}
              title="Identity-First Generation"
              desc="Identity-preserving character generation across scenes, outfits, and poses"
            />
            <Feature
              icon={<Crown className="w-6 h-6 text-pink-400" />}
              title="Premium Features"
              desc="Access SFW, NSFW, and ULTRA creative modes"
            />
            <Feature
              icon={<Star className="w-6 h-6 text-cyan-400" />}
              title="Exclusive Access"
              desc="OG Founders & Early Birds unlock elite platform perks"
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Card className="border-gray-700 bg-gray-800/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-center text-2xl text-white">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </CardTitle>
              <CardDescription className="text-center text-gray-300">
                {mode === "login" ? "Sign in to continue" : "Join SirensForge today"}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Button disabled={oauthBusy} onClick={handleGoogleLogin} variant="outline" className="bg-white text-gray-900">
                  Google
                </Button>
                <Button disabled={oauthBusy} onClick={handleDiscordLogin} variant="outline" className="bg-[#5865F2] text-white">
                  Discord
                </Button>
              </div>

              <Divider />

              <form onSubmit={handleSubmit} className="space-y-4">
                {checkEmail && <p className="text-cyan-300 text-sm" role="status">Check your email to confirm your account, then continue signing in.</p>}
                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div>
                  <Label className="text-gray-300">Email</Label>
                  <Input
                    type="email"
                    className="bg-gray-900 border-gray-700 text-white placeholder:text-gray-500"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <Label className="text-gray-300">Password</Label>
                  <PasswordInput
                    value={password}
                    onChange={setPassword}
                    show={showPassword}
                    setShow={setShowPassword}
                  />
                </div>

                <Button
                  disabled={isLoading || checkEmail}
                  className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white"
                >
                  {isLoading ? "Loading..." : mode === "login" ? "Sign in" : "Create account"}
                </Button>
              </form>

              <div className="text-center text-sm text-gray-400">
                {checkEmail ? (
                  <button type="button" className="text-purple-400 hover:underline" onClick={() => flow.returnToSignIn()}>
                    Return to sign in
                  </button>
                ) : (
                  <>
                    {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                    <button
                      type="button"
                      className="text-purple-400 hover:underline"
                      onClick={() => flow.setMode(mode === "login" ? "signup" : "login")}
                    >
                      {mode === "login" ? "Sign up" : "Sign in"}
                    </button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}

function Feature({ icon, title, desc }: any) {
  return (
    <div className="flex items-start gap-4 p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
      <div className="p-2 rounded-lg bg-white/10">{icon}</div>
      <div>
        <h3 className="font-semibold text-white">{title}</h3>
        <p className="text-sm text-gray-400">{desc}</p>
      </div>
    </div>
  )
}

function Divider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-gray-700" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-gray-800 px-2 text-gray-400">
          Or continue with email
        </span>
      </div>
    </div>
  )
}

function PasswordInput({ value, onChange, show, setShow }: any) {
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border-gray-700 text-white placeholder:text-gray-500 pr-10"
        required
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
      >
        {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
      </button>
    </div>
  )
}
