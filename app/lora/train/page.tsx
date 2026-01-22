"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Upload,
  X,
  Check,
  Sparkles,
  Crown,
  AlertCircle,
  Clock,
  CheckCircle,
  Star,
  Zap,
  Heart,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/* SUPABASE */
/* ------------------------------------------------------------------ */

const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ------------------------------------------------------------------ */
/* TYPES */
/* ------------------------------------------------------------------ */

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  uploadStatus: "uploading" | "complete" | "error";
}

type TrainingStatus = "idle" | "queued" | "training" | "completed" | "failed";

type LoraRow = {
  id: string;
  status: TrainingStatus;
  progress?: number | null;
  error_message?: string | null;
  updated_at?: string | null;
};

const POLL_INTERVAL_MS = 5000;

/* ------------------------------------------------------------------ */
/* EFFECTS */
/* ------------------------------------------------------------------ */

const FloatingParticles = () => {
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });

  useEffect(() => {
    setDimensions({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-purple-400 rounded-full"
          initial={{
            x: Math.random() * dimensions.width,
            y: Math.random() * dimensions.height,
            opacity: 0,
          }}
          animate={{
            y: Math.random() * -100 - 50,
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: Math.random() * 3 + 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
};

const Confetti = () => {
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });

  useEffect(() => {
    setDimensions({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(50)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full"
          style={{
            background: ["#a855f7", "#ec4899", "#06b6d4", "#10b981", "#f59e0b"][i % 5],
            left: `${Math.random() * 100}%`,
            top: "-10px",
          }}
          initial={{ y: -10, opacity: 1, rotate: 0 }}
          animate={{
            y: dimensions.height + 10,
            opacity: 0,
            rotate: Math.random() * 360,
          }}
          transition={{
            duration: Math.random() * 2 + 1,
            delay: Math.random() * 0.5,
          }}
        />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* PAGE */
/* ------------------------------------------------------------------ */

export default function LoRATrainerPage() {
  const [identityName, setIdentityName] = useState("");
  const [description, setDescription] = useState("");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus>("idle");
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [mounted, setMounted] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const clearPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const mapStatus = (status: string): TrainingStatus => {
    if (status === "queued") return "queued";
    if (status === "training") return "training";
    if (status === "completed") return "completed";
    if (status === "failed") return "failed";
    return "idle";
  };

  const pollStatus = useCallback(async () => {
    const { data } = await supabaseClient
      .from("user_loras")
      .select("status,progress,error_message")
      .limit(1)
      .single();

    if (!data) return;

    const next = mapStatus(data.status);
    setTrainingStatus(next);

    if (typeof data.progress === "number") {
      setTrainingProgress(Math.max(0, Math.min(100, data.progress)));
    }

    if (next === "failed") {
      setErrorMessage(data.error_message || "Training failed.");
      clearPolling();
    }

    if (next === "completed") {
      setTrainingProgress(100);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      clearPolling();
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (trainingStatus === "queued" || trainingStatus === "training") {
      pollStatus();
      pollingRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
    }

    return () => clearPolling();
  }, [trainingStatus, pollStatus]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <FloatingParticles />
      {showConfetti && <Confetti />}

      <div className="max-w-4xl mx-auto px-6 py-20 space-y-8">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-3xl">Train Your Identity</CardTitle>
            <CardDescription>
              Upload 10–20 images to forge your AI twin
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <Label>Identity Name</Label>
            <Input
              value={identityName}
              onChange={(e) => setIdentityName(e.target.value)}
              placeholder="Scarlet Muse"
              className="bg-gray-900 border-gray-700 text-white"
            />

            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-gray-900 border-gray-700 text-white"
            />

            {errorMessage && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex gap-3">
                <AlertCircle />
                <span>{errorMessage}</span>
              </div>
            )}

            <Button
              disabled
              className="w-full py-6 text-lg bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600"
            >
              Start Training
            </Button>
          </CardContent>
        </Card>
      </div>

      <AnimatePresence>
        {trainingStatus !== "idle" && (
          <motion.div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <Card className="bg-gray-900 border-gray-800 p-10 text-center space-y-6">
              {trainingStatus === "queued" && (
                <>
                  <Clock className="w-16 h-16 mx-auto text-amber-400 animate-spin" />
                  <h2 className="text-2xl font-bold">Queued</h2>
                </>
              )}
              {trainingStatus === "training" && (
                <>
                  <Sparkles className="w-16 h-16 mx-auto text-cyan-400 animate-spin" />
                  <h2 className="text-2xl font-bold">Training…</h2>
                  <p>{trainingProgress}%</p>
                </>
              )}
              {trainingStatus === "completed" && (
                <>
                  <CheckCircle className="w-16 h-16 mx-auto text-emerald-400" />
                  <h2 className="text-2xl font-bold">Training Complete</h2>
                </>
              )}
              {trainingStatus === "failed" && (
                <>
                  <AlertCircle className="w-16 h-16 mx-auto text-rose-400" />
                  <h2 className="text-2xl font-bold">Training Failed</h2>
                </>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
