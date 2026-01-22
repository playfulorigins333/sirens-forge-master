"use client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
import { useSearchParams } from "next/navigation";

/* ────────────────────────────────────────────── */
/* CONFIG */
/* ────────────────────────────────────────────── */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TrainingStatus = "idle" | "queued" | "training" | "completed" | "failed";

type UploadedImage = {
  id: string;
  file: File;
  preview: string;
};

const POLL_INTERVAL_MS = 5000;

/* ────────────────────────────────────────────── */
/* PAGE */
/* ────────────────────────────────────────────── */

export default function LoRATrainerPage() {
  const params = useSearchParams();
  const loraId = params.get("lora_id"); // REQUIRED, already exists

  const [identityName, setIdentityName] = useState("");
  const [description, setDescription] = useState("");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [trainingStatus, setTrainingStatus] =
    useState<TrainingStatus>("idle");
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  /* ────────────────────────────────────────────── */
  /* GUARDS */
  /* ────────────────────────────────────────────── */

  useEffect(() => {
    if (!loraId) {
      setErrorMessage("Missing LoRA ID. Please return to your dashboard.");
    }
  }, [loraId]);

  /* ────────────────────────────────────────────── */
  /* FILE HANDLING */
  /* ────────────────────────────────────────────── */

  const handleFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));

    if (uploadedImages.length + images.length > 20) {
      setErrorMessage("Maximum 20 images allowed.");
      return;
    }

    const next = images.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setUploadedImages((prev) => [...prev, ...next]);
    setErrorMessage(null);
  };

  const removeImage = (id: string) => {
    setUploadedImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter((i) => i.id !== id);
    });
  };

  /* ────────────────────────────────────────────── */
  /* AUTH */
  /* ────────────────────────────────────────────── */

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  /* ────────────────────────────────────────────── */
  /* START TRAINING */
  /* ────────────────────────────────────────────── */

  const handleStartTraining = async () => {
    if (!loraId) return;
    if (uploadedImages.length < 10 || uploadedImages.length > 20) return;

    setErrorMessage(null);
    setTrainingStatus("queued");
    setTrainingProgress(0);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You must be logged in.");

      const form = new FormData();
      form.append("lora_id", loraId);

      uploadedImages.forEach((img) => {
        form.append("images", img.file);
      });

      const res = await fetch("/api/lora/start-training", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.error || "Failed to start training.");
      }
    } catch (err: any) {
      setTrainingStatus("failed");
      setErrorMessage(err.message || "Training failed.");
    }
  };

  /* ────────────────────────────────────────────── */
  /* POLLING */
  /* ────────────────────────────────────────────── */

  const pollStatus = useCallback(async () => {
    if (!loraId) return;

    const { data, error } = await supabase
      .from("user_loras")
      .select("status,progress,error_message")
      .eq("id", loraId)
      .single();

    if (error || !data) return;

    setTrainingStatus(data.status);
    if (typeof data.progress === "number") {
      setTrainingProgress(Math.min(100, Math.max(0, data.progress)));
    }

    if (data.status === "completed" || data.status === "failed") {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (data.status === "failed") {
        setErrorMessage(data.error_message || "Training failed.");
      }
    }
  }, [loraId]);

  useEffect(() => {
    if (trainingStatus === "queued" || trainingStatus === "training") {
      pollStatus();
      pollingRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [trainingStatus, pollStatus]);

  /* ────────────────────────────────────────────── */
  /* RENDER */
  /* ────────────────────────────────────────────── */

  const ready =
    uploadedImages.length >= 10 && uploadedImages.length <= 20;

  return (
    <div className="min-h-screen bg-black text-white p-10">
      <Card className="max-w-3xl mx-auto bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-3xl">Train Your Identity</CardTitle>
          <CardDescription>
            Upload 10–20 images to train this LoRA
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div>
            <Label>Training Images</Label>
            <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) =>
                  e.target.files && handleFiles(Array.from(e.target.files))
                }
                className="hidden"
                id="file"
              />
              <label htmlFor="file" className="cursor-pointer">
                <Upload className="w-10 h-10 mx-auto mb-2 text-purple-400" />
                <p>Click or drag images here</p>
              </label>
            </div>
          </div>

          {uploadedImages.length > 0 && (
            <div className="grid grid-cols-4 gap-4">
              {uploadedImages.map((img) => (
                <div key={img.id} className="relative">
                  <img
                    src={img.preview}
                    className="rounded-lg object-cover"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex gap-3">
              <AlertCircle />
              <span>{errorMessage}</span>
            </div>
          )}

          <Button
            disabled={!ready || trainingStatus !== "idle"}
            onClick={handleStartTraining}
            className="w-full py-6 text-lg bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600"
          >
            {trainingStatus === "idle"
              ? "Start Training"
              : "Training in progress…"}
          </Button>
        </CardContent>
      </Card>

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
