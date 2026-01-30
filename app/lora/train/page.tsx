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

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  uploadStatus: "uploading" | "complete" | "error";
}

type TrainingStatus = "idle" | "queued" | "training" | "completed" | "failed";

const supabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type LoraRow = {
  id: string;
  status: TrainingStatus;
  progress?: number | null;
  error_message?: string | null;
  updated_at?: string | null;
};

const POLL_INTERVAL_MS = 5000;

// Floating particles component
const FloatingParticles = () => {
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });
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

// Confetti component
const Confetti = () => {
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });

  useEffect(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(50)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-full"
          style={{
            background: ["#a855f7", "#ec4899", "#06b6d4", "#10b981", "#f59e0b"][
              i % 5
            ],
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

export default function LoRATrainerPage() {
  const [identityName, setIdentityName] = useState("");
  const [description, setDescription] = useState("");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus>("idle");
  const [loraId, setLoraId] = useState<string | null>(null);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

  const clearPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const mapDbStatusToUi = (dbStatus: string): TrainingStatus => {
    if (dbStatus === "queued") return "queued";
    if (dbStatus === "training") return "training";
    if (dbStatus === "completed") return "completed";
    if (dbStatus === "failed") return "failed";
    return "idle";
  };

  const pollLoraStatusOnce = useCallback(async (id: string) => {
    try {
      const res = await fetch(
        `/api/lora/status?lora_id=${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMessage(json?.error || "Failed to poll training status.");
        return;
      }

      const row = (json?.lora || null) as LoraRow | null;
      if (!row) return;

      const next = mapDbStatusToUi(String(row.status || "idle"));
      setTrainingStatus(next);

      if (typeof row.progress === "number") {
        const clamped = Math.max(0, Math.min(100, row.progress));
        setTrainingProgress(clamped);
      }

      if (next === "failed") {
        setErrorMessage(row.error_message || "Training failed.");
        clearPolling();
      }

      if (next === "completed") {
        setErrorMessage(null);
        setTrainingProgress(100);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
        clearPolling();
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to poll training status.");
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    clearPolling();

    if (!loraId) return;
    if (
      trainingStatus === "completed" ||
      trainingStatus === "failed" ||
      trainingStatus === "idle"
    )
      return;

    pollLoraStatusOnce(loraId);

    pollingIntervalRef.current = setInterval(() => {
      pollLoraStatusOnce(loraId);
    }, POLL_INTERVAL_MS);

    return () => {
      clearPolling();
    };
  }, [mounted, loraId, trainingStatus, pollLoraStatusOnce]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mounted]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    },
    [uploadedImages]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const files = Array.from(e.target.files);
        handleFiles(files);
      }
    },
    [uploadedImages]
  );

  const handleFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (uploadedImages.length + imageFiles.length > 20) {
      setErrorMessage("Maximum 20 images allowed");
      return;
    }

    const newImages: UploadedImage[] = imageFiles.map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      uploadStatus: "complete",
    }));

    setUploadedImages((prev) => [...prev, ...newImages]);
    setErrorMessage(null);
  };

  const removeImage = (id: string) => {
    setUploadedImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const getAccessToken = async (): Promise<string | null> => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  };

  const uploadImagesToR2 = async (
    loraIdForPath: string,
    images: UploadedImage[]
  ): Promise<void> => {
    const res = await fetch("/api/lora/get-upload-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lora_id: loraIdForPath,
        image_count: images.length,
      }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({} as any));
      throw new Error(j?.error || "Failed to get R2 upload URLs");
    }

    const { urls } = (await res.json()) as {
      urls: { url: string; key: string }[];
    };

    if (!Array.isArray(urls) || urls.length !== images.length) {
      throw new Error("R2 upload URL count mismatch");
    }

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const putUrl = urls[i].url;

      const putRes = await fetch(putUrl, {
        method: "PUT",
        body: img.file,
      });

      if (!putRes.ok) {
        throw new Error(`R2 upload failed on image ${i + 1}`);
      }
    }
  };

  const uploadImagesToSupabaseStorage = async (
    loraIdForPath: string,
    images: UploadedImage[]
  ): Promise<void> => {
    // Upload to: lora_datasets/<lora_id>/img_1.jpg ... img_20.jpg
    const bucket = "lora-datasets";
    const basePath = `lora_datasets/${loraIdForPath}`;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const file = img.file;

      const objectPath = `${basePath}/img_${i + 1}.jpg`;

      const { error: uploadErr } = await supabaseClient.storage
        .from(bucket)
        .upload(objectPath, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        throw new Error(
          `Storage upload failed on image ${i + 1}: ${uploadErr.message}`
        );
      }
    }
  };

  const handleStartTraining = async () => {
    if (uploadedImages.length < 10 || uploadedImages.length > 20) return;
    if (!identityName.trim()) return;

    setErrorMessage(null);
    setTrainingProgress(0);
    setTrainingStatus("training");

    try {

      /**
       * ✅ NEW LOCKED FLOW (Option A):
       * 1) Create a LoRA DB row (draft) via /api/lora/create
       * 2) Upload images directly from browser → Supabase Storage
       * 3) Call /api/lora/train with metadata only (NO images) to queue training
       *
       * This avoids Vercel multipart size limits completely.
       */

      // 1) Create draft row
      const createDraftRes = await fetch("/api/lora/create", {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identityName: identityName.trim(),
          description: (description?.trim() || "") || null,
        }),
      });

      const draftJson = await createDraftRes.json().catch(() => ({} as any));

      if (!createDraftRes.ok) {
        setTrainingStatus("failed");
        setErrorMessage(draftJson?.error || "Failed to create LoRA draft.");
        return;
      }

      const createdId = draftJson?.lora_id as string | undefined;
      if (!createdId) {
        setTrainingStatus("failed");
        setErrorMessage("Server response missing lora_id.");
        return;
      }

      setLoraId(createdId);

      // 2) Upload images directly to R2 (browser → R2 via presigned PUT URLs)
      // This is REQUIRED because the training worker reads datasets from R2:
      // s3://identity-loras/lora_datasets/<lora_id>/...
      await uploadImagesToR2(createdId, uploadedImages);

      // 3) Queue training (metadata only)
      const queueRes = await fetch("/api/lora/train", {
        credentials: "include",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lora_id: createdId,
          identityName: identityName.trim(),
          description: (description?.trim() || "") || null,
          image_count: uploadedImages.length,
        }),
      });

      const queueJson = await queueRes.json().catch(() => ({} as any));

      if (!queueRes.ok) {
        setTrainingStatus("failed");
        setErrorMessage(
          queueJson?.error ||
  "Failed to queue training."
        );
        return;
      }

      // Keep status queued; polling effect will take over.
    } catch (err: any) {
      console.error("Start training error:", err);
      setTrainingStatus("failed");
      setErrorMessage(err?.message || "Unexpected error starting training.");
    }
  };

  const handleRetry = () => {
    clearPolling();
    setTrainingStatus("idle");
    setTrainingProgress(0);
    setErrorMessage(null);
    setLoraId(null);
  };

  const getProgressColor = () => {
    const count = uploadedImages.length;
    if (count < 10) return "bg-rose-500";
    if (count < 15) return "bg-amber-500";
    return "bg-emerald-500";
  };

  const getProgressTextColor = () => {
    const count = uploadedImages.length;
    if (count < 10) return "text-rose-400";
    if (count < 15) return "text-amber-400";
    return "text-emerald-400";
  };

  const isReadyToTrain = uploadedImages.length >= 10 && identityName.trim().length > 0;

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-pink-900/20" />
        <motion.div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(168, 85, 247, 0.15), transparent 40%)`,
          }}
        />
        <FloatingParticles />
      </div>

      {/* Header */}
      <header className="border-b border-gray-800/50 bg-black/50 backdrop-blur-xl top-0 z-40 relative">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <motion.h1
              className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"
              animate={{
                backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
              }}
              transition={{ duration: 5, repeat: Infinity }}
            >
              SirensForge
            </motion.h1>
            <Button
              variant="ghost"
              onClick={() => (window.location.href = "/")}
              className="hover:bg-purple-500/10"
            >
              Back to Dashboard
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center relative z-10"
      >
        <motion.div
          animate={{
            scale: [1, 1.02, 1],
            rotate: [0, 1, -1, 0],
          }}
          transition={{ duration: 4, repeat: Infinity }}
          className="inline-block mb-6"
        >
          <div className="relative">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 rounded-full blur-3xl opacity-50"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.5, 0.8, 0.5],
              }}
              transition={{ duration: 3, repeat: Infinity }}
            />
            <Sparkles className="w-20 h-20 text-purple-400 relative z-10" />
          </div>
        </motion.div>

        <motion.h1
          className="text-6xl md:text-7xl font-bold mb-6 relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent inline-block">
            Forge Your AI Twin
          </span>
          <motion.div
            className="absolute -top-4 -right-4"
            animate={{
              rotate: [0, 10, -10, 0],
              scale: [1, 1.2, 1],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Star className="w-8 h-8 text-yellow-400 fill-yellow-400" />
          </motion.div>
        </motion.h1>

        <motion.p
          className="text-xl md:text-2xl text-gray-300 mb-6 max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Create a{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-semibold">
            persistent AI identity
          </span>{" "}
          that brings your vision to life across images and video
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-500/30 backdrop-blur-sm"
        >
          <Crown className="w-5 h-5 text-yellow-400" />
          <span className="text-sm font-semibold bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
            One identity at a time
          </span>
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Zap className="w-4 h-4 text-cyan-400" />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 pb-20 space-y-8 relative z-10">
        {/* Identity Details Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          whileHover={{ scale: 1.01 }}
        >
          <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-purple-500/10 relative overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-pink-600/10 to-cyan-600/10"
              animate={{
                backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
              }}
              transition={{ duration: 10, repeat: Infinity }}
            />
            <CardHeader className="relative z-10">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: [0, 360] }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                >
                  <Heart className="w-6 h-6 text-pink-400" />
                </motion.div>
                <CardTitle className="text-3xl bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                  Identity Details
                </CardTitle>
              </div>
              <CardDescription className="text-gray-400">
                Name your creation and bring it to life
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 relative z-10">
              <div className="space-y-3">
                <Label
                  htmlFor="identity-name"
                  className="text-base flex items-center gap-2 text-gray-200"
                >
                  <span>Identity Name</span>
                  <span className="text-rose-400">*</span>
                  <motion.span
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="text-xs text-purple-400"
                  >
                    ✨ Make it memorable
                  </motion.span>
                </Label>
                <div className="relative group">
                  <motion.div
                    className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 rounded-lg opacity-0 group-hover:opacity-100 blur transition-opacity"
                    animate={{
                      backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                    }}
                    transition={{ duration: 3, repeat: Infinity }}
                  />
                  <Input
                    id="identity-name"
                    value={identityName}
                    onChange={(e) => setIdentityName(e.target.value)}
                    placeholder="My AI Twin, Scarlet Muse, Digital Goddess..."
                    maxLength={50}
                    className="bg-gray-900/90 border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 text-lg py-7 relative z-10 backdrop-blur-sm text-white placeholder:text-gray-500"
                  />
                  {identityName.trim().length > 0 && (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-20"
                    >
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        <Check className="w-6 h-6 text-emerald-400" />
                      </motion.div>
                    </motion.div>
                  )}
                </div>
                <p className="text-xs text-gray-500 flex items-center justify-between">
                  <span>{identityName.length} / 50 characters</span>
                  {identityName.length > 30 && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-amber-400"
                    >
                      Almost there! ⚡
                    </motion.span>
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <Label
                  htmlFor="description"
                  className="text-base flex items-center gap-2 text-gray-200"
                >
                  <span>Description</span>
                  <span className="text-gray-500 text-sm">(optional)</span>
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your AI identity's personality, style, or purpose..."
                  maxLength={200}
                  className="bg-gray-900/90 border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 min-h-28 resize-none backdrop-blur-sm text-white placeholder:text-gray-500"
                />
                <p className="text-xs text-gray-500">
                  For your reference only • {description.length} / 200 characters
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Training Images Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          whileHover={{ scale: 1.01 }}
        >
          <Card className="border-gray-800/50 bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur-xl shadow-2xl shadow-pink-500/10 relative overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-pink-600/10 via-purple-600/10 to-cyan-600/10"
              animate={{
                backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
              }}
              transition={{ duration: 10, repeat: Infinity }}
            />
            <CardHeader className="relative z-10">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{
                    y: [0, -5, 0],
                    rotate: [0, 5, -5, 0],
                  }}
                  transition={{ duration: 3, repeat: Infinity }}
                >
                  <Upload className="w-6 h-6 text-cyan-400" />
                </motion.div>
                <CardTitle className="text-3xl bg-gradient-to-r from-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Training Images
                </CardTitle>
              </div>
              <CardDescription className="text-gray-400">
                Upload 10-20 high-quality images to train your AI
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 relative z-10">
              {/* Progress Indicator */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <motion.span
                    className={`text-lg font-bold ${getProgressTextColor()}`}
                    animate={{
                      scale:
                        uploadedImages.length >= 10 ? [1, 1.1, 1] : 1,
                    }}
                    transition={{ duration: 0.5 }}
                  >
                    {uploadedImages.length} / 20 images uploaded
                  </motion.span>
                  <span className="text-sm text-gray-500">
                    {uploadedImages.length < 10 ? (
                      <span className="text-rose-400">
                        ⚠️ {10 - uploadedImages.length} more needed
                      </span>
                    ) : (
                      <motion.span
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-emerald-400"
                      >
                        ✨ Ready to train!
                      </motion.span>
                    )}
                  </span>
                </div>
                <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(uploadedImages.length / 20) * 100}%` }}
                    transition={{ duration: 0.5, type: "spring" }}
                    className={`h-full ${getProgressColor()} rounded-full relative`}
                  >
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                  </motion.div>
                </div>
              </div>

              {/* Upload Zone */}
              <motion.div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                whileHover={{ scale: 1.02 }}
                className={`relative border-2 border-dashed rounded-2xl p-16 text-center transition-all ${
                  isDragging
                    ? "border-purple-500 bg-purple-500/20 scale-105"
                    : "border-gray-700 hover:border-purple-500/50 hover:bg-purple-500/5"
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileInput}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploadedImages.length >= 20}
                />
                <motion.div
                  animate={{
                    y: isDragging ? -10 : [0, -10, 0],
                    scale: isDragging ? 1.1 : 1,
                  }}
                  transition={{
                    duration: 2,
                    repeat: isDragging ? 0 : Infinity,
                  }}
                >
                  <Upload className="w-16 h-16 mx-auto mb-4 text-purple-400" />
                </motion.div>
                <p className="text-xl font-semibold mb-2">
                  {uploadedImages.length >= 20 ? (
                    <span className="text-amber-400">Maximum images reached ⚡</span>
                  ) : isDragging ? (
                    <span className="text-purple-400">Drop your images here! ✨</span>
                  ) : (
                    <span>Drag & drop your images here</span>
                  )}
                </p>
                <p className="text-sm text-gray-400">or click to browse your files</p>
                {uploadedImages.length === 0 && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 }}
                    className="text-xs text-purple-400 mt-4"
                  >
                    💡 Tip: Use clear, well-lit photos for best results
                  </motion.p>
                )}
              </motion.div>

              {/* Image Grid */}
              {uploadedImages.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  <AnimatePresence>
                    {uploadedImages.map((image, index) => (
                      <motion.div
                        key={image.id}
                        initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.5, rotate: 10 }}
                        transition={{ delay: index * 0.05 }}
                        whileHover={{ scale: 1.05, zIndex: 10 }}
                        className="relative aspect-square rounded-xl overflow-hidden group"
                      >
                        <img
                          src={image.preview}
                          alt="Training image"
                          className="w-full h-full object-cover"
                        />
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                          initial={false}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeImage(image.id)}
                            className="bg-rose-500/90 hover:bg-rose-600 text-white backdrop-blur-sm"
                          >
                            <X className="w-5 h-5" />
                          </Button>
                        </motion.div>
                        <motion.div
                          className="absolute top-2 right-2 bg-emerald-500 rounded-full p-1"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: index * 0.05 + 0.2 }}
                        >
                          <Check className="w-3 h-3 text-white" />
                        </motion.div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* Guidelines */}
              <motion.div
                className="space-y-3 p-6 rounded-xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-500/30 backdrop-blur-sm"
                whileHover={{ scale: 1.02 }}
              >
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  className="flex items-center justify-between w-full text-left group"
                >
                  <span className="font-semibold text-cyan-400 flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    Upload Guidelines
                  </span>
                  <motion.div
                    animate={{ rotate: showInfo ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Star className="w-5 h-5 text-cyan-400" />
                    </motion.div>
                  </motion.div>
                </button>
                <AnimatePresence>
                  {showInfo && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3 text-sm text-gray-300 overflow-hidden"
                    >
                      {[
                        { icon: Check, text: "Minimum: 10 images required", color: "text-emerald-400" },
                        { icon: Star, text: "Maximum: 20 images for best results", color: "text-purple-400" },
                        { icon: Sparkles, text: "Clear faces recommended", color: "text-cyan-400" },
                        { icon: Zap, text: "Mix of angles and expressions encouraged", color: "text-pink-400" },
                      ].map((item, index) => (
                        <motion.div
                          key={index}
                          initial={{ x: -20, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          transition={{ delay: index * 0.1 }}
                          className="flex items-start gap-3 p-3 rounded-lg bg-black/30 hover:bg-black/50 transition-colors"
                        >
                          <item.icon className={`w-5 h-5 ${item.color} mt-0.5 flex-shrink-0`} />
                          <span>{item.text}</span>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Training Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          whileHover={{ scale: 1.02 }}
        >
          <Card className="border-gray-800/50 bg-gradient-to-br from-purple-900/30 via-pink-900/30 to-gray-900/90 backdrop-blur-xl relative overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-pink-600/20 to-cyan-600/20"
              animate={{
                backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
              }}
              transition={{ duration: 8, repeat: Infinity }}
            />
            <CardContent className="p-8 relative z-10">
              <div className="flex items-start gap-6">
                <motion.div
                  className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 backdrop-blur-sm"
                  animate={{
                    rotate: [0, 5, -5, 0],
                    scale: [1, 1.05, 1],
                  }}
                  transition={{ duration: 4, repeat: Infinity }}
                >
                  <Sparkles className="w-8 h-8 text-purple-300" />
                </motion.div>
                <div className="flex-1 space-y-4">
                  <h3 className="font-bold text-2xl bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                    How the Magic Works ✨
                  </h3>
                  <ul className="space-y-3 text-gray-300">
                    {[
                      { icon: Crown, text: "Your identity is trained once and lives forever", color: "text-yellow-400" },
                      { icon: Zap, text: "Use it across images, videos, and future creations", color: "text-cyan-400" },
                      { icon: Clock, text: "Training takes just a few minutes", color: "text-purple-400" },
                      { icon: Star, text: "Create multiple identities to build your AI universe", color: "text-pink-400" },
                    ].map((item, index) => (
                      <motion.li
                        key={index}
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.5 + index * 0.1 }}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <item.icon className={`w-5 h-5 ${item.color} mt-0.5 flex-shrink-0`} />
                        <span>{item.text}</span>
                      </motion.li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {trainingStatus === "failed" && errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 flex items-start gap-3"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm leading-relaxed">{errorMessage}</div>
          </motion.div>
        )}

        {/* Action Button */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <motion.div
            whileHover={{ scale: isReadyToTrain ? 1.02 : 1 }}
            whileTap={{ scale: isReadyToTrain ? 0.98 : 1 }}
          >
            <Button
              onClick={handleStartTraining}
              disabled={!isReadyToTrain || trainingStatus !== "idle"}
              className="w-full py-10 text-xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xl shadow-purple-500/50 relative overflow-hidden group"
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
              {!isReadyToTrain ? (
                <>
                  <Upload className="w-6 h-6 mr-3" />
                  Upload at least 10 images to continue
                </>
              ) : trainingStatus === "idle" ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  >
                    <Sparkles className="w-6 h-6 mr-3" />
                  </motion.div>
                  Begin the Transformation
                  <Zap className="w-6 h-6 ml-3" />
                </>
              ) : (
                <>
                  <Clock className="w-6 h-6 mr-3 animate-spin" />
                  Forging your AI identity...
                </>
              )}
            </Button>
          </motion.div>
        </motion.div>
      </div>

      {/* Training Status Modal */}
      <AnimatePresence>
        {trainingStatus !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-4"
          >
            {showConfetti && <Confetti />}
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: "spring", damping: 20 }}
              className="max-w-lg w-full bg-gradient-to-br from-gray-900 to-black rounded-3xl border border-gray-800 shadow-2xl overflow-hidden relative"
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-pink-600/20 to-cyan-600/20"
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                }}
                transition={{ duration: 5, repeat: Infinity }}
              />

              <div className="p-12 text-center space-y-8 relative z-10">
                {/* Status Icon */}
                <div className="flex justify-center">
                  {trainingStatus === "queued" && (
                    <motion.div
                      animate={{
                        scale: [1, 1.2, 1],
                        rotate: [0, 180, 360],
                      }}
                      transition={{ duration: 3, repeat: Infinity }}
                      className="p-8 rounded-full bg-gradient-to-br from-amber-500/30 to-orange-500/30 backdrop-blur-sm"
                    >
                      <Clock className="w-16 h-16 text-amber-400" />
                    </motion.div>
                  )}
                  {trainingStatus === "training" && (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                      className="p-8 rounded-full bg-gradient-to-br from-cyan-500/30 to-purple-500/30 backdrop-blur-sm relative"
                    >
                      <Sparkles className="w-16 h-16 text-cyan-400" />
                      <motion.div
                        className="absolute inset-0 rounded-full border-4 border-cyan-400/30"
                        animate={{ scale: [1, 1.3, 1], opacity: [1, 0, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    </motion.div>
                  )}
                  {trainingStatus === "completed" && (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", duration: 0.8 }}
                      className="p-8 rounded-full bg-gradient-to-br from-emerald-500/30 to-green-500/30 backdrop-blur-sm relative"
                    >
                      <CheckCircle className="w-16 h-16 text-emerald-400" />
                      <motion.div
                        className="absolute inset-0 rounded-full border-4 border-emerald-400/50"
                        animate={{ scale: [1, 1.5], opacity: [1, 0] }}
                        transition={{ duration: 1, repeat: 3 }}
                      />
                    </motion.div>
                  )}
                  {trainingStatus === "failed" && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring" }}
                      className="p-8 rounded-full bg-gradient-to-br from-rose-500/30 to-red-500/30 backdrop-blur-sm"
                    >
                      <AlertCircle className="w-16 h-16 text-rose-400" />
                    </motion.div>
                  )}
                </div>

                {/* Status Message */}
                <div className="space-y-4">
                  {trainingStatus === "queued" && (
                    <>
                      <motion.h3
                        className="text-3xl font-bold text-amber-400"
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        Queued for Magic ✨
                      </motion.h3>
                      <p className="text-gray-300 text-lg">
                        Your identity is next in line for transformation
                      </p>
                      {loraId && (
                        <p className="text-xs text-gray-400 mt-2">
                          LoRA Job: <span className="font-mono">{loraId}</span>
                        </p>
                      )}
                    </>
                  )}

                  {trainingStatus === "training" && (
                    <>
                      <motion.h3
                        className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
                        animate={{
                          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                        }}
                        transition={{ duration: 3, repeat: Infinity }}
                      >
                        Forging Your AI Twin
                      </motion.h3>
                      <p className="text-gray-300 text-lg">
                        Weaving pixels into digital consciousness...
                      </p>
                      {loraId && (
                        <p className="text-xs text-gray-400 mt-2">
                          LoRA Job: <span className="font-mono">{loraId}</span>
                        </p>
                      )}
                      <div className="pt-6 space-y-4">
                        <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${trainingProgress}%` }}
                            className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-full relative"
                          >
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
                              animate={{ x: ["-100%", "200%"] }}
                              transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                            />
                          </motion.div>
                        </div>
                        <motion.p
                          className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
                          animate={{ scale: [1, 1.05, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          {Math.round(trainingProgress)}%
                        </motion.p>
                      </div>
                    </>
                  )}

                  {trainingStatus === "completed" && (
                    <>
                      <motion.h3
                        className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", delay: 0.2 }}
                      >
                        Your AI Twin is Alive! 🎉
                      </motion.h3>
                      <motion.p
                        className="text-gray-300 text-lg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                      >
                        <span className="font-bold text-2xl bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                          {identityName}
                        </span>
                        <br />
                        is ready to create magic with you
                      </motion.p>
                    </>
                  )}

                  {trainingStatus === "failed" && (
                    <>
                      <h3 className="text-3xl font-bold text-rose-400">
                        Oops! Something went wrong
                      </h3>
                      <p className="text-gray-300 text-lg">
                        The training couldn't complete.
                      </p>
                    </>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-6">
                  {trainingStatus === "completed" && (
                    <>
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.6 }}
                      >
                        <Button
                          onClick={() => (window.location.href = "/")}
                          className="w-full py-6 text-lg font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 shadow-xl"
                        >
                          <Sparkles className="w-5 h-5 mr-2" />
                          Start Creating Now
                          <Zap className="w-5 h-5 ml-2" />
                        </Button>
                      </motion.div>

                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.7 }}
                      >
                        <Button
                          variant="outline"
                          onClick={() => {
                            clearPolling();
                            setTrainingStatus("idle");
                            setTrainingProgress(0);
                            setIdentityName("");
                            setDescription("");
                            uploadedImages.forEach((img) =>
                              URL.revokeObjectURL(img.preview)
                            );
                            setUploadedImages([]);
                            setLoraId(null);
                          }}
                          className="w-full py-6 border-gray-700 hover:bg-gray-800"
                        >
                          <Crown className="w-5 h-5 mr-2" />
                          Forge Another Identity
                        </Button>
                      </motion.div>
                    </>
                  )}

                  {trainingStatus === "failed" && (
                    <>
                      <Button
                        onClick={handleRetry}
                        className="w-full py-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500"
                      >
                        <Zap className="w-5 h-5 mr-2" />
                        Try Again
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setTrainingStatus("idle")}
                        className="w-full py-6 border-gray-700"
                      >
                        Upload Different Images
                      </Button>
                    </>
                  )}

                  {(trainingStatus === "queued" || trainingStatus === "training") && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        clearPolling();
                        setTrainingStatus("idle");
                        setTrainingProgress(0);
                        setLoraId(null);
                      }}
                      className="w-full py-6 border-gray-700 hover:bg-gray-800"
                    >
                      Cancel Training
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// END OF FILE