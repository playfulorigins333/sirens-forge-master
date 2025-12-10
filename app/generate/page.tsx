"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Crown,
  Star,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Wand2,
  ChevronDown,
  ChevronUp,
  Shield,
  Upload,
  X,
  Check,
  Clock,
  Search,
  Play,
  Maximize2,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type GenerationMode =
  | "text_to_image"
  | "image_to_image"
  | "image_to_video"
  | "text_to_video";

type BaseModel = "feminine" | "masculine" | "mtf" | "ftm";
type ContentMode = "sfw" | "nsfw" | "ultra";
type StylePreset =
  | "photorealistic"
  | "cinematic"
  | "editorial"
  | "soft_glam"
  | "artistic"
  | "anime";

type QualityPreset = "fast" | "balanced" | "quality" | "ultra";
type ConsistencyPreset = "low" | "medium" | "high" | "perfect";

type FluxLockType = "face_only" | "body_only" | "face_and_body";
type FluxLockStrength = "subtle" | "balanced" | "strong";

type MediaKind = "image" | "video";

interface GeneratedItem {
  id: string;
  kind: MediaKind;
  url: string;
  prompt: string;
  settings: any;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferKindFromOutput(output: any): MediaKind {
  if (output.kind === "video" || output.kind === "image") {
    return output.kind;
  }
  const url = (output.url || "").toLowerCase();
  if (
    url.endsWith(".mp4") ||
    url.endsWith(".webm") ||
    url.includes("video")
  ) {
    return "video";
  }
  return "image";
}

// -----------------------------------------------------------------------------
// Subscription Modal (Neon SirensForge Style)
// -----------------------------------------------------------------------------

interface SubscriptionModalProps {
  open: boolean;
  message?: string | null;
  onClose: () => void;
  onGoPricing: () => void;
}

function SubscriptionModal({
  open,
  message,
  onClose,
  onGoPricing,
}: SubscriptionModalProps) {
  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-lg mx-4"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          {/* Neon border wrapper */}
          <div className="absolute -inset-[2px] rounded-3xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-80 blur-sm animate-pulse" />
          <div className="relative rounded-3xl bg-gray-950/95 border border-purple-700/60 shadow-[0_0_40px_rgba(168,85,247,0.6)] overflow-hidden">
            <div className="px-6 pt-5 pb-4 border-b border-purple-900/50 flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-cyan-500 flex items-center justify-center text-black shadow-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Subscription Required to Forge
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Generator access is locked to SirensForge members. OG &amp;
                  Early Bird tiers get full image &amp; video generation.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 space-y-3 text-sm text-gray-200">
              {message && (
                <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/40 rounded-lg px-3 py-2">
                  {message}
                </p>
              )}

              <p className="text-xs text-gray-300">
                To keep the platform fast, exclusive, and creator-first, the
                Forge is currently limited to paid members:
              </p>

              <ul className="text-xs text-gray-300 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <span>
                    <span className="font-semibold text-purple-200">
                      OG Founders
                    </span>{" "}
                    — lifetime access, best perks, highest priority in the
                    queue.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-pink-400" />
                  <span>
                    <span className="font-semibold text-pink-200">
                      Early Bird
                    </span>{" "}
                    — full generator access at launch pricing.
                  </span>
                </li>
              </ul>

              <p className="text-[11px] text-gray-400 pt-1">
                You&apos;re seeing this message because your account doesn&apos;t
                have an active tier with generator access yet.
              </p>
            </div>

            <div className="px-6 pb-5 pt-2 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center border-t border-purple-900/40 bg-gradient-to-r from-purple-950/60 via-black to-cyan-950/40">
              <div className="text-[11px] text-gray-400">
                <p>
                  Smash the competition at launch by locking in{" "}
                  <span className="text-purple-300 font-semibold">
                    OG
                  </span>{" "}
                  or{" "}
                  <span className="text-pink-300 font-semibold">
                    Early Bird
                  </span>{" "}
                  access before seats are gone.
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="border-gray-700 bg-gray-900 text-gray-200 text-xs h-9 px-3"
                >
                  Stay on this page
                </Button>
                <Button
                  type="button"
                  onClick={onGoPricing}
                  className="text-xs h-9 px-4 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 hover:from-purple-400 hover:via-pink-400 hover:to-cyan-400 text-black font-semibold shadow-[0_0_20px_rgba(168,85,247,0.8)]"
                >
                  View Plans &amp; Unlock Access
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

function GeneratorHeader() {
  // For now, static placeholders; gate is handled via route/middleware.
  const userName = "Creator";
  const userAvatar = "";
  const badge: "OG_FOUNDER" | "EARLY_BIRD" | "STARTER_HIT" | null = null;
  const subscriptionStatus: "active" | "inactive" = "active";

  const getBadgeConfig = () => {
    switch (badge) {
      case "OG_FOUNDER":
        return {
          icon: Crown,
          text: "OG FOUNDER",
          color: "from-yellow-400 to-orange-500",
        };
      case "EARLY_BIRD":
        return {
          icon: Star,
          text: "EARLY BIRD",
          color: "from-blue-400 to-cyan-500",
        };
      case "STARTER_HIT":
        return {
          icon: Sparkles,
          text: "STARTER HIT",
          color: "from-purple-400 to-pink-500",
        };
      default:
        return null;
    }
  };

  const badgeConfig = getBadgeConfig();

  return (
    <header className="border-b border-gray-800 bg-gray-950/70 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            SirensForge Generator
          </h1>
          <p className="text-xs md:text-sm text-gray-400 mt-1">
            Text &amp; Image → Images &amp; Video • SDXL + FLUX Lock + DNA Lock
          </p>
        </div>

        <div className="flex items-center gap-4">
          {badgeConfig && (
            <div
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${badgeConfig.color} text-white text-xs font-bold`}
            >
              <badgeConfig.icon className="w-3 h-3" />
              {badgeConfig.text}
            </div>
          )}

          <div
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
              subscriptionStatus === "active"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-gray-800 text-gray-400 border border-gray-700"
            }`}
          >
            {subscriptionStatus === "active"
              ? "✅ Active Subscription"
              : "⚠️ Inactive"}
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-purple-500/60">
              <AvatarImage src={userAvatar} alt={userName} />
              <AvatarFallback className="bg-gray-900 text-purple-300">
                {userName[0]}
              </AvatarFallback>
            </Avatar>
            <span className="hidden md:block text-sm font-medium text-gray-100">
              {userName}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

// -----------------------------------------------------------------------------
// Mode Tabs
// -----------------------------------------------------------------------------

function ModeTabs(props: {
  activeMode: GenerationMode;
  onChange: (mode: GenerationMode) => void;
}) {
  const modes: { id: GenerationMode; label: string; icon: React.ElementType }[] =
    [
      { id: "text_to_image", label: "Text → Image", icon: FileText },
      { id: "image_to_image", label: "Image → Image", icon: ImageIcon },
      { id: "image_to_video", label: "Image → Video", icon: VideoIcon },
      { id: "text_to_video", label: "Text → Video", icon: Wand2 },
    ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = props.activeMode === mode.id;
        return (
          <motion.button
            key={mode.id}
            onClick={() => props.onChange(mode.id)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`relative p-3 rounded-xl border-2 transition-all ${
              isActive
                ? "border-purple-500 bg-purple-500/10"
                : "border-gray-800 bg-gray-900/70 hover:border-gray-700"
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <Icon
                className={`w-5 h-5 ${
                  isActive ? "text-purple-400" : "text-gray-400"
                }`}
              />
              <span
                className={`text-xs font-semibold ${
                  isActive ? "text-white" : "text-gray-400"
                }`}
              >
                {mode.label}
              </span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Prompt Section
// -----------------------------------------------------------------------------

function PromptSection(props: {
  prompt: string;
  negativePrompt: string;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
}) {
  const [showNegative, setShowNegative] = useState(false);

  const styleChips = [
    "Add more detail",
    "Sharpen anatomy",
    "Soft lighting",
    "High fashion",
    "Cinematic mood",
    "Professional photography",
  ];

  const addChip = (chip: string) => {
    const lower = chip.toLowerCase();
    props.onPromptChange(props.prompt ? `${props.prompt}, ${lower}` : lower);
  };

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Sparkles className="w-5 h-5 text-purple-400" />
          Prompt Builder
        </CardTitle>
        <CardDescription className="text-xs text-gray-400">
          Describe exactly what you want SirensForge to create. This feeds SDXL
          / Flux / video models.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Textarea
            value={props.prompt}
            onChange={(e) => props.onPromptChange(e.target.value)}
            placeholder="Describe the scene, style, mood, and details..."
            className="min-h-32 bg-gray-950 border-gray-800 resize-none text-sm"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {props.prompt.length} characters
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {styleChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => addChip(chip)}
              className="px-3 py-1.5 text-[11px] rounded-full bg-gray-800 hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
            >
              + {chip}
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setShowNegative((v) => !v)}
          className="w-full justify-between text-xs"
        >
          <span>Refine / avoid styles (negative prompt)</span>
          {showNegative ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </Button>

        <AnimatePresence>
          {showNegative && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <Textarea
                value={props.negativePrompt}
                onChange={(e) => props.onNegativePromptChange(e.target.value)}
                placeholder="What to avoid (e.g. bad anatomy, extra limbs, blurry, etc.)"
                className="min-h-24 bg-gray-950 border-gray-800 resize-none text-sm mt-2"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Model & Style Section (Base model + SFW/NSFW/ULTRA + style preset)
// -----------------------------------------------------------------------------

function ModelStyleSection(props: {
  baseModel: BaseModel;
  contentMode: ContentMode;
  stylePreset: StylePreset;
  onBaseModelChange: (model: BaseModel) => void;
  onContentModeChange: (mode: ContentMode) => void;
  onStylePresetChange: (preset: StylePreset) => void;
}) {
  const baseModels: { id: BaseModel; label: string }[] = [
    { id: "feminine", label: "Feminine" },
    { id: "masculine", label: "Masculine" },
    { id: "mtf", label: "MTF" },
    { id: "ftm", label: "FTM" },
  ];

  const stylePresets: StylePreset[] = [
    "photorealistic",
    "cinematic",
    "editorial",
    "soft_glam",
    "artistic",
    "anime",
  ];

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base">Model & Style</CardTitle>
        <CardDescription className="text-xs text-gray-400">
          SDXL core model (bigLust_v16) with body-specific LoRA shaping +
          content modes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Base model */}
        <div>
          <p className="text-xs font-semibold mb-2 text-gray-200">
            Base Model (Body Type)
          </p>
          <div className="grid grid-cols-2 gap-3">
            {baseModels.map((bm) => {
              const isActive = props.baseModel === bm.id;
              return (
                <button
                  key={bm.id}
                  type="button"
                  onClick={() => props.onBaseModelChange(bm.id)}
                  className={`p-3 rounded-lg border-2 text-xs font-semibold transition-all ${
                    isActive
                      ? "border-purple-500 bg-purple-500/10 text-white"
                      : "border-gray-800 bg-gray-950 text-gray-400 hover:border-gray-700"
                  }`}
                >
                  {bm.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content mode */}
        <div>
          <p className="text-xs font-semibold mb-2 text-gray-200">
            Content Mode
          </p>
          <div className="space-y-2 text-xs">
            <label
              className={`flex items-center justify-between p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                props.contentMode === "sfw"
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-gray-800 hover:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="contentMode"
                  checked={props.contentMode === "sfw"}
                  onChange={() => props.onContentModeChange("sfw")}
                />
                <div>
                  <div className="font-semibold">SFW</div>
                  <div className="text-[10px] text-gray-400">
                    Safe-for-work content, social-friendly.
                  </div>
                </div>
              </div>
              <Shield className="w-4 h-4 text-emerald-400" />
            </label>

            <label
              className={`flex items-center justify-between p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                props.contentMode === "nsfw"
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-gray-800 hover:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="contentMode"
                  checked={props.contentMode === "nsfw"}
                  onChange={() => props.onContentModeChange("nsfw")}
                />
                <div>
                  <div className="font-semibold">NSFW</div>
                  <div className="text-[10px] text-gray-400">
                    Adult content within policy.
                  </div>
                </div>
              </div>
            </label>

            <label
              className={`flex items-center justify-between p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                props.contentMode === "ultra"
                  ? "border-rose-500 bg-rose-500/10"
                  : "border-gray-800 hover:border-gray-700"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="contentMode"
                  checked={props.contentMode === "ultra"}
                  onChange={() => props.onContentModeChange("ultra")}
                />
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    ULTRA
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500 text-white">
                      18+
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-400">
                    Full NSFW pipeline (no illegal content).
                  </div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Style preset */}
        <div>
          <p className="text-xs font-semibold mb-2 text-gray-200">
            Style Preset
          </p>
          <div className="flex flex-wrap gap-2">
            {stylePresets.map((preset) => {
              const isActive = props.stylePreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => props.onStylePresetChange(preset)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    isActive
                      ? "bg-purple-500 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {preset.replace("_", " ")}
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// DNA Lock (high-level, front-end only for now)
// -----------------------------------------------------------------------------

function DNALockSection(props: {
  files: File[];
  onUpload: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const maxImages = 8;
  const minImages = 5;
  const isReady = props.files.length >= minImages;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files || []);
    const allowed = incoming.slice(
      0,
      Math.max(0, maxImages - props.files.length)
    );
    if (allowed.length) props.onUpload(allowed);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const incoming = Array.from(e.dataTransfer.files || []);
    const allowed = incoming.slice(
      0,
      Math.max(0, maxImages - props.files.length)
    );
    if (allowed.length) props.onUpload(allowed);
  };

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base">
          Character DNA Lock
        </CardTitle>
        <CardDescription className="text-xs text-gray-400">
          Upload 5–8 photos to lock a face + body combo across image &amp; video
          generations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() =>
            (
              document.getElementById(
                "dna-upload-input"
              ) as HTMLInputElement | null
            )?.click()
          }
          className="border-2 border-dashed border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-purple-500 transition-colors"
        >
          <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
          <p className="text-sm text-gray-200 mb-1">
            Drop or click to upload reference photos
          </p>
          <p className="text-[11px] text-gray-500 mb-1">
            Clear, frontal faces work best. Avoid filters &amp; heavy makeup.
          </p>
          <p className="text-[11px] text-gray-500">
            {props.files.length}/{maxImages} uploaded
          </p>
          <input
            id="dna-upload-input"
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {props.files.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {props.files.map((file, index) => (
              <div
                key={index}
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-950 group"
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={`DNA ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemove(index);
                  }}
                  className="absolute top-1 right-1 p-1 bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
            isReady
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500 bg-amber-500/10 text-amber-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {isReady ? (
              <Check className="w-4 h-4" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>
              {isReady
                ? "DNA Pack Ready for face/body consistency."
                : "Upload at least 5 photos to enable DNA Lock."}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// FLUX Lock Section (simplified front-end UI for now)
// -----------------------------------------------------------------------------

function FluxLockSection(props: {
  lockType: FluxLockType;
  lockStrength: FluxLockStrength;
  onLockTypeChange: (t: FluxLockType) => void;
  onLockStrengthChange: (s: FluxLockStrength) => void;
}) {
  const lockTypes: { id: FluxLockType; label: string; description: string }[] =
    [
      {
        id: "face_only",
        label: "Face Only",
        description: "Lock facial features with FLUX.",
      },
      {
        id: "body_only",
        label: "Body Only",
        description: "Lock physique / proportions.",
      },
      {
        id: "face_and_body",
        label: "Face + Body",
        description: "Max consistency for both.",
      },
    ];

  const strengths: { id: FluxLockStrength; label: string }[] = [
    { id: "subtle", label: "Subtle" },
    { id: "balanced", label: "Balanced" },
    { id: "strong", label: "Strong" },
  ];

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base flex items-center gap-2">
          FLUX Face &amp; Body Lock
          <span className="text-lg">🔒</span>
        </CardTitle>
        <CardDescription className="text-xs text-gray-400">
          High-end FLUX lock controls. Combined with DNA pack, this is your
          competitive edge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div>
          <p className="font-semibold mb-2 text-gray-200">Lock Type</p>
          <div className="grid grid-cols-3 gap-2">
            {lockTypes.map((lt) => {
              const isActive = props.lockType === lt.id;
              return (
                <button
                  key={lt.id}
                  type="button"
                  onClick={() => props.onLockTypeChange(lt.id)}
                  className={`p-2.5 rounded-lg border-2 transition-all ${
                    isActive
                      ? "border-purple-500 bg-purple-500/10 text-white"
                      : "border-gray-800 bg-gray-950 text-gray-300 hover:border-gray-700"
                  }`}
                >
                  <div className="font-semibold text-[11px]">{lt.label}</div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {lt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-gray-200">Lock Strength</p>
            <span className="text-[11px] text-purple-300 font-semibold">
              {props.lockStrength[0].toUpperCase() +
                props.lockStrength.slice(1)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={
              props.lockStrength === "subtle"
                ? 0
                : props.lockStrength === "balanced"
                ? 1
                : 2
            }
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10);
              const map: FluxLockStrength[] = [
                "subtle",
                "balanced",
                "strong",
              ];
              props.onLockStrengthChange(map[idx] ?? "balanced");
            }}
            className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            <span>Subtle</span>
            <span>Balanced</span>
            <span>Strong</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-500">
          On the backend, this maps into FLUX IP-Adapter strength + LoRA blend
          so you can keep faces and bodies locked between images and video.
        </p>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Advanced Settings (resolution, CFG, steps, seed, batch size)
// -----------------------------------------------------------------------------

function AdvancedSettings(props: {
  resolution: string;
  guidance: number;
  steps: number;
  seed: number;
  lockSeed: boolean;
  batchSize: number;
  onResolutionChange: (value: string) => void;
  onGuidanceChange: (value: number) => void;
  onStepsChange: (value: number) => void;
  onSeedChange: (value: number) => void;
  onLockSeedChange: (value: boolean) => void;
  onBatchSizeChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const resolutions = [
    "1024x1024",
    "832x1216",
    "1024x1536",
    "1216x832",
    "1536x1024",
  ];

  const randomizeSeed = () => {
    props.onSeedChange(Math.floor(Math.random() * 1_000_000));
  };

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="py-3">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full justify-between px-0 hover:bg-transparent"
        >
          <CardTitle className="text-sm md:text-base">
            Advanced Settings
          </CardTitle>
          {open ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </Button>
      </CardHeader>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <CardContent className="space-y-4 text-xs pt-0 pb-4">
              {/* Resolution */}
              <div>
                <p className="font-semibold mb-1 text-gray-200">Resolution</p>
                <Select
                  value={props.resolution}
                  onValueChange={props.onResolutionChange}
                >
                  <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-950 border-gray-800">
                    {resolutions.map((res) => (
                      <SelectItem key={res} value={res}>
                        {res}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-gray-500 mt-1">
                  SDXL max 1024x1792, Flux/Sora higher in video.
                </p>
              </div>

              {/* CFG */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">
                    CFG / Guidance Scale
                  </p>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {props.guidance.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={0.5}
                  value={props.guidance}
                  onChange={(e) =>
                    props.onGuidanceChange(parseFloat(e.target.value))
                  }
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Steps</p>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {props.steps}
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={75}
                  step={1}
                  value={props.steps}
                  onChange={(e) =>
                    props.onStepsChange(parseInt(e.target.value, 10) || 20)
                  }
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              {/* Seed */}
              <div>
                <p className="font-semibold mb-1 text-gray-200">Seed</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={props.seed}
                    onChange={(e) =>
                      props.onSeedChange(parseInt(e.target.value, 10) || 0)
                    }
                    className="bg-gray-950 border-gray-800 h-8 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={randomizeSeed}
                    className="border-gray-800 h-8 w-8"
                  >
                    <Sparkles className="w-4 h-4" />
                  </Button>
                </div>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={props.lockSeed}
                    onChange={(e) =>
                      props.onLockSeedChange(e.target.checked)
                    }
                    className="w-4 h-4 rounded border-gray-700 bg-gray-950 accent-purple-500"
                  />
                  <span className="text-xs text-gray-400">
                    Lock seed for reproducible outputs.
                  </span>
                </label>
              </div>

              {/* Batch size */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Batch Size</p>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {props.batchSize}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={props.batchSize}
                  onChange={(e) =>
                    props.onBatchSizeChange(
                      Math.max(1, parseInt(e.target.value, 10) || 1)
                    )
                  }
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Generate Button
// -----------------------------------------------------------------------------

function GenerateButton(props: {
  isGenerating: boolean;
  batchSize: number;
  qualityPreset: QualityPreset;
  consistencyPreset: ConsistencyPreset;
  disabled?: boolean;
  onClick: () => void;
}) {
  const subtext = `This will create ${props.batchSize} ${
    props.batchSize > 1 ? "outputs" : "output"
  } at ${props.qualityPreset} quality with ${props.consistencyPreset} consistency.`;

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardContent className="p-4">
        <motion.div
          whileHover={{
            scale: props.disabled || props.isGenerating ? 1 : 1.02,
          }}
          whileTap={{
            scale: props.disabled || props.isGenerating ? 1 : 0.98,
          }}
        >
          <Button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled || props.isGenerating}
            className={`w-full h-12 text-sm md:text-base font-semibold transition-all ${
              props.disabled || props.isGenerating
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 shadow-lg shadow-purple-500/30"
            }`}
          >
            {props.isGenerating ? (
              <span className="flex items-center gap-2">
                <Clock className="w-4 h-4 animate-spin" />
                Generating…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Generate
              </span>
            )}
          </Button>
        </motion.div>
        <p className="text-[11px] text-gray-400 text-center mt-2">{subtext}</p>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Output Grid + Modal
// -----------------------------------------------------------------------------

function OutputPanel(props: { items: GeneratedItem[]; loading: boolean }) {
  const [selected, setSelected] = useState<GeneratedItem | null>(null);

  if (props.loading) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">Generating…</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="aspect-square rounded-xl bg-gray-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!props.items.length) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <Sparkles className="w-12 h-12 mx-auto text-gray-700" />
          <h2 className="text-base md:text-lg font-semibold text-gray-300">
            Your creations will appear here
          </h2>
          <p className="text-xs text-gray-500">
            Describe something on the left and press Generate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">
          Latest Generation
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {props.items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="relative group aspect-square rounded-xl overflow-hidden bg-gray-950 border border-gray-800"
            >
              {item.kind === "image" ? (
                <img
                  src={item.url}
                  alt={item.prompt}
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={item.url}
                  className="w-full h-full object-cover"
                  controls={false}
                  muted
                  loop
                />
              )}

              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => setSelected(item)}
                  className="bg-white/10 hover:bg-white/20"
                >
                  <Maximize2 className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    window.open(item.url, "_blank");
                  }}
                  className="bg-white/10 hover:bg-white/20"
                >
                  <DownloadIcon />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-4xl w-full bg-gray-950 rounded-xl overflow-hidden border border-gray-800"
            >
              {selected.kind === "image" ? (
                <img
                  src={selected.url}
                  alt={selected.prompt}
                  className="w-full h-auto"
                />
              ) : (
                <video
                  src={selected.url}
                  className="w-full h-auto"
                  controls
                  autoPlay
                  muted
                  loop
                />
              )}
              <div className="p-4 space-y-2 text-xs">
                <p className="text-gray-300">{selected.prompt}</p>
                <p className="text-[10px] text-gray-500">
                  {new Date(selected.createdAt).toLocaleString()}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function DownloadIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 20h14v-2H5v2zm7-3 5-5h-3V4h-4v8H7l5 5z"
        fill="currentColor"
      />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// History Sidebar
// -----------------------------------------------------------------------------

function HistorySidebar(props: {
  history: GeneratedItem[];
  onSelect: (item: GeneratedItem) => void;
  onRerun: (item: GeneratedItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "images" | "videos">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const filtered = [...props.history]
    .filter((item) => {
      const matchesQuery = item.prompt
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesFilter =
        filter === "all" ||
        (filter === "images" && item.kind === "image") ||
        (filter === "videos" && item.kind === "video");
      return matchesQuery && matchesFilter;
    })
    .sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return sort === "newest" ? bt - at : at - bt;
    });

  return (
    <div className="h-full overflow-y-auto p-3 md:p-4 space-y-3 border-l border-gray-900 bg-gray-950/70">
      <h3 className="text-sm md:text-base font-bold text-gray-100">
        Session History
      </h3>

      <div className="space-y-2 text-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <Input
            placeholder="Filter by prompt…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-gray-950 border-gray-800 h-8 text-xs"
          />
        </div>

        <div className="flex gap-2">
          <Select
            value={filter}
            onValueChange={(v) =>
              setFilter(v as "all" | "images" | "videos")
            }
          >
            <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="images">Images</SelectItem>
              <SelectItem value="videos">Videos</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sort}
            onValueChange={(v) => setSort(v as "newest" | "oldest")}
          >
            <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800">
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2 p-2 rounded-lg bg-gray-900/80 border border-gray-800 hover:border-gray-700 cursor-pointer"
            onClick={() => props.onSelect(item)}
          >
            {item.kind === "image" ? (
              <img
                src={item.url}
                alt={item.prompt}
                className="w-12 h-12 rounded object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center">
                <VideoIcon className="w-5 h-5 text-purple-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-gray-100 line-clamp-2">
                {item.prompt}
              </p>
              <p className="text-[10px] text-gray-500 mt-1">
                {new Date(item.createdAt).toLocaleTimeString()}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                props.onRerun(item);
              }}
              className="shrink-0 h-7 w-7"
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
          </motion.div>
        ))}
      </div>

      {!filtered.length && (
        <div className="text-center py-8 text-[11px] text-gray-500">
          No history this session yet.
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MAIN PAGE
// -----------------------------------------------------------------------------

export default function GeneratePage() {
  const router = useRouter();

  // Core state
  const [mode, setMode] = useState<GenerationMode>("text_to_image");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [baseModel, setBaseModel] = useState<BaseModel>("feminine");
  const [contentMode, setContentMode] = useState<ContentMode>("sfw");
  const [stylePreset, setStylePreset] =
    useState<StylePreset>("photorealistic");
  const [qualityPreset] = useState<QualityPreset>("balanced");
  const [consistencyPreset] = useState<ConsistencyPreset>("medium");

  // DNA & FLUX
  const [dnaFiles, setDnaFiles] = useState<File[]>([]);
  const [fluxLockType, setFluxLockType] =
    useState<FluxLockType>("face_and_body");
  const [fluxLockStrength, setFluxLockStrength] =
    useState<FluxLockStrength>("balanced");

  // Advanced
  const [resolution, setResolution] = useState("1024x1024");
  const [guidance, setGuidance] = useState(7.5);
  const [steps, setSteps] = useState(30);
  const [seed, setSeed] = useState(0);
  const [lockSeed, setLockSeed] = useState(false);
  const [batchSize, setBatchSize] = useState(1);

  // Output & history
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [history, setHistory] = useState<GeneratedItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Subscription modal state
  const [showSubModal, setShowSubModal] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null
  );

  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  const handleGenerate = async () => {
    if (!canGenerate) return;

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      // Build payload to match /api/generate GenerationRequestPayload
      const payload = {
        mode,
        prompt,
        negativePrompt,
        baseModel,
        contentMode,
        stylePreset,
        qualityPreset,
        consistencyPreset,
        resolution,
        guidance,
        steps,
        seed: lockSeed ? seed : null,
        lockSeed,
        batchSize,
        dnaPack: {
          count: dnaFiles.length,
          hasFiles: dnaFiles.length > 0,
        },
        fluxLock: {
          type: fluxLockType,
          strength: fluxLockStrength,
        },
        imageInput: null as any, // reserved for future image-to-image / img2vid
      };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      // 🔐 Subscription / gating handling (Step 5)
      if (res.status === 402 || res.status === 403) {
        let reason = "You need an active SirensForge subscription with generator access.";
        try {
          const data = await res.json();
          if (typeof data?.error === "string") {
            reason = data.error;
          } else if (typeof data?.message === "string") {
            reason = data.message;
          } else if (typeof data?.code === "string") {
            reason = data.code;
          }
        } catch {
          // ignore parse errors; keep default reason
        }

        setSubscriptionError(reason);
        setShowSubModal(true);
        setIsGenerating(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Generate failed with status ${res.status}`);
      }

      const data = await res.json();

      // If backend ever returns outputs directly:
      const immediateOutputs: any[] =
        (Array.isArray(data.outputs) && data.outputs) ||
        (Array.isArray(data.output) && data.output) ||
        [];

      if (immediateOutputs.length) {
        const now = new Date().toISOString();
        const generated: GeneratedItem[] = immediateOutputs.map(
          (output: any) => ({
            id: `${now}-${Math.random().toString(36).slice(2)}`,
            kind: inferKindFromOutput(output),
            url: output.url,
            prompt,
            settings: payload,
            createdAt: output.createdAt || now,
          })
        );

        setItems((prev) => [...generated, ...prev].slice(0, 12));
        setHistory((prev) => [...generated, ...prev]);
        return;
      }

      const jobId: string | undefined =
        data.job_id || data.id || data.jobId || undefined;

      if (!jobId) {
        throw new Error("No job_id or outputs returned from /api/generate");
      }

      // Poll /api/status until completed
      const timeoutMs = 90_000;
      const intervalMs = 1500;
      const start = Date.now();

      let finalStatus: any = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() - start > timeoutMs) {
          throw new Error("Generation timed out. Try again.");
        }

        const statusRes = await fetch(
          `/api/status?job_id=${encodeURIComponent(jobId)}`
        );
        if (!statusRes.ok) {
          throw new Error(`Status check failed: ${statusRes.status}`);
        }

        const statusData = await statusRes.json();
        const status = String(statusData.status || "").toUpperCase();

        if (
          status === "COMPLETED" &&
          (Array.isArray(statusData.outputs) ||
            Array.isArray(statusData.output))
        ) {
          finalStatus = statusData;
          break;
        }

        if (status === "FAILED") {
          throw new Error(
            statusData.error || "Generation failed on the backend."
          );
        }

        await sleep(intervalMs);
      }

      const outputs: any[] =
        (Array.isArray(finalStatus.outputs) && finalStatus.outputs) ||
        (Array.isArray(finalStatus.output) && finalStatus.output) ||
        [];

      const now = new Date().toISOString();

      const generated: GeneratedItem[] = outputs.map((output: any) => ({
        id: `${jobId}-${Math.random().toString(36).slice(2)}`,
        kind: inferKindFromOutput(output),
        url: output.url,
        prompt,
        settings: payload,
        createdAt: output.createdAt || now,
      }));

      setItems((prev) => [...generated, ...prev].slice(0, 12));
      setHistory((prev) => [...generated, ...prev]);
    } catch (err: any) {
      console.error("Generation error:", err);
      setErrorMessage(
        err?.message ||
          "Something went wrong starting the generation. Check backend logs."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleHistorySelect = (item: GeneratedItem) => {
    setPrompt(item.prompt);
    // later: restore full settings from item.settings if you want
  };

  const handleHistoryRerun = (item: GeneratedItem) => {
    setPrompt(item.prompt);
    handleGenerate();
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 flex flex-col">
      <GeneratorHeader />

      <main className="flex-1 flex flex-col md:flex-row">
        {/* Left + center */}
        <div className="flex-1 px-4 md:px-6 py-4 md:py-6 space-y-4 max-w-6xl mx-auto w-full">
          {/* Mode tabs */}
          <ModeTabs activeMode={mode} onChange={setMode} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Left column: prompt + DNA/FLUX */}
            <div className="space-y-4 xl:col-span-1">
              <PromptSection
                prompt={prompt}
                negativePrompt={negativePrompt}
                onPromptChange={setPrompt}
                onNegativePromptChange={setNegativePrompt}
              />
              <DNALockSection
                files={dnaFiles}
                onUpload={(files) =>
                  setDnaFiles((prev) => [...prev, ...files])
                }
                onRemove={(idx) =>
                  setDnaFiles((prev) => prev.filter((_, i) => i !== idx))
                }
              />
              <FluxLockSection
                lockType={fluxLockType}
                lockStrength={fluxLockStrength}
                onLockTypeChange={setFluxLockType}
                onLockStrengthChange={setFluxLockStrength}
              />
            </div>

            {/* Middle column: model/style + advanced + generate */}
            <div className="space-y-4 xl:col-span-1">
              <ModelStyleSection
                baseModel={baseModel}
                contentMode={contentMode}
                stylePreset={stylePreset}
                onBaseModelChange={setBaseModel}
                onContentModeChange={setContentMode}
                onStylePresetChange={setStylePreset}
              />
              <AdvancedSettings
                resolution={resolution}
                guidance={guidance}
                steps={steps}
                seed={seed}
                lockSeed={lockSeed}
                batchSize={batchSize}
                onResolutionChange={setResolution}
                onGuidanceChange={setGuidance}
                onStepsChange={setSteps}
                onSeedChange={setSeed}
                onLockSeedChange={setLockSeed}
                onBatchSizeChange={setBatchSize}
              />
              <GenerateButton
                isGenerating={isGenerating}
                batchSize={batchSize}
                qualityPreset={qualityPreset}
                consistencyPreset={consistencyPreset}
                disabled={!canGenerate}
                onClick={handleGenerate}
              />
              {errorMessage && (
                <p className="text-[11px] text-red-400">{errorMessage}</p>
              )}
            </div>

            {/* Right column: output */}
            <div className="space-y-4 xl:col-span-1">
              <Card className="border-gray-800 bg-gray-900/80 h-full">
                <CardContent className="p-4 h-full">
                  <OutputPanel items={items} loading={isGenerating} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* History sidebar */}
        <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-gray-900">
          <HistorySidebar
            history={history}
            onSelect={handleHistorySelect}
            onRerun={handleHistoryRerun}
          />
        </div>
      </main>

      {/* Subscription gating modal */}
      <SubscriptionModal
        open={showSubModal}
        message={subscriptionError}
        onClose={() => setShowSubModal(false)}
        onGoPricing={() => router.push("/pricing")}
      />
    </div>
  );
}
