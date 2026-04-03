"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Crown,
  Star,
  Video as VideoIcon,
  FileText,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  Clock,
  Search,
  Play,
  Maximize2,
  AlertTriangle,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
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

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type GenerationMode =
  | "text_to_image"
  | "image_to_image"
  | "image_to_video"
  | "text_to_video";

type BaseModel = "feminine" | "masculine";
type StylePreset =
  | "photorealistic"
  | "cinematic"
  | "editorial"
  | "soft_glam"
  | "artistic"
  | "anime";

type QualityPreset = "fast" | "balanced" | "quality" | "ultra";
type ConsistencyPreset = "low" | "medium" | "high" | "perfect";

type LoraMode = "single" | "advanced";

interface LoraSelection {
  mode: LoraMode;
  selected: string[];
  createNew: boolean;
  newName: string;
}

type MediaKind = "image" | "video";

interface GeneratedItem {
  id: string;
  kind: MediaKind;
  url: string;
  prompt: string;
  settings: any;
  createdAt: string;
}

function inferKindFromOutput(output: any): MediaKind {
  if (typeof output === "string") {
    const url = output.toLowerCase();
    if (url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video")) {
      return "video";
    }
    return "image";
  }

  if (output?.kind === "video" || output?.kind === "image") {
    return output.kind;
  }

  const url = String(output?.url || "").toLowerCase();
  if (url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video")) {
    return "video";
  }
  return "image";
}

function getOutputUrl(output: any): string {
  if (typeof output === "string") return output;
  return output?.url || "";
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read uploaded image."));
    reader.readAsDataURL(file);
  });
}

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
                <p className="text-xs text-gray-300 mt-0.5">
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
              <div className="text-[11px] text-gray-300">
                <p>
                  Smash the competition at launch by locking in{" "}
                  <span className="text-purple-300 font-semibold">OG</span> or{" "}
                  <span className="text-pink-300 font-semibold">Early Bird</span>{" "}
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

function GeneratorHeader(props: { activeMode: GenerationMode }) {
  const userName = "Creator";
  const userAvatar = "";
  const badge: "OG_FOUNDER" | "EARLY_BIRD" | null = null;
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
      default:
        return null;
    }
  };

  const badgeConfig = getBadgeConfig();

  const subtitle =
    props.activeMode === "image_to_video"
      ? "Image → Video • Flux / I2V motion"
      : props.activeMode === "text_to_video"
      ? "Text → Video • Flux Cinematic"
      : "Text → Image • SDXL + LoRA Identity";

  return (
    <header className="border-b border-gray-800 bg-gray-950/70 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            SirensForge Generator
          </h1>
          <p className="text-xs md:text-sm text-gray-300 mt-1">{subtitle}</p>
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
                : "bg-gray-800 text-gray-300 border border-gray-700"
            }`}
          >
            {subscriptionStatus === "active" ? "✅ Active Subscription" : "⚠️ Inactive"}
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

function ModeTabs(props: {
  activeMode: GenerationMode;
  onChange: (mode: GenerationMode) => void;
}) {
  const modes: { id: GenerationMode; label: string; icon: React.ElementType }[] = [
    { id: "text_to_image", label: "Text → Image", icon: FileText },
    { id: "image_to_video", label: "Image → Video", icon: ImageIcon },
    { id: "text_to_video", label: "Text → Video", icon: VideoIcon },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  isActive ? "text-purple-400" : "text-gray-300"
                }`}
              />
              <span
                className={`text-xs font-semibold ${
                  isActive ? "text-white" : "text-gray-300"
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

function PromptSection(props: {
  mode: GenerationMode;
  prompt: string;
  negativePrompt: string;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
}) {
  const [showNegative, setShowNegative] = useState(false);

  const styleChips =
    props.mode === "text_to_image"
      ? [
          "Add more detail",
          "Sharpen anatomy",
          "Soft lighting",
          "High fashion",
          "Cinematic mood",
          "Professional photography",
        ]
      : props.mode === "image_to_video"
      ? ["Slow movement", "Subtle camera motion", "Breathing motion", "Cinematic energy"]
      : ["Cinematic motion", "Slow dolly", "Atmospheric lighting", "Seductive pacing"];

  const addChip = (chip: string) => {
    const lower = chip.toLowerCase();
    props.onPromptChange(props.prompt ? `${props.prompt}, ${lower}` : lower);
  };

  const description =
    props.mode === "image_to_video"
      ? "Optional motion guidance for the uploaded image."
      : props.mode === "text_to_video"
      ? "Describe the motion scene, style, pacing, and camera feel."
      : "Describe exactly what you want SirensForge to create.";

  const placeholder =
    props.mode === "image_to_video"
      ? "Optional: describe the movement, camera energy, mood, and pacing..."
      : props.mode === "text_to_video"
      ? "Describe the full video scene, motion, pacing, and mood..."
      : "Describe the scene, style, mood, and details...";

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Sparkles className="w-5 h-5 text-purple-400" />
          Prompt Builder
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Textarea
            value={props.prompt}
            onChange={(e) => props.onPromptChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-32 bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 resize-none text-sm"
          />
          <p className="text-[10px] text-gray-400 mt-1">
            {props.prompt.length} characters
          </p>
          <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-[11px] text-gray-300">
            Tip: Describe the subject clearly for better repeatability. Example:{" "}
            <span className="text-gray-100 font-medium">
              same woman, consistent face, repeatable character
            </span>
            .
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {styleChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => addChip(chip)}
              className="px-3 py-1.5 text-[11px] rounded-full bg-gray-800 text-gray-200 hover:bg-purple-500/20 hover:text-purple-200 transition-colors"
            >
              + {chip}
            </button>
          ))}
        </div>

        <Button
          type="button"
          onClick={() => setShowNegative((v) => !v)}
          className="w-full justify-between text-xs bg-gray-950 border border-gray-800 text-gray-100 hover:bg-gray-900 hover:text-white"
        >
          <span>Refine & filter (negative prompt) ✨</span>
          {showNegative ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                className="min-h-24 bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 resize-none text-sm mt-2"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function ImageToVideoUploadSection(props: {
  imageFile: File | null;
  previewUrl: string | null;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Upload className="w-5 h-5 text-cyan-400" />
          Source Image
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          Upload the image you want to animate into motion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!props.imageFile ? (
          <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 bg-gray-950 px-4 py-8 text-center cursor-pointer hover:border-purple-500/60 transition-colors">
            <Upload className="w-7 h-7 text-purple-400" />
            <span className="text-xs text-gray-300">Click to upload an image for animation</span>
            <span className="text-[10px] text-gray-500">PNG, JPG, WEBP</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => props.onFileChange(e.target.files?.[0] || null)}
            />
          </label>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 space-y-3">
            {props.previewUrl && (
              <img src={props.previewUrl} alt="Upload preview" className="w-full rounded-lg max-h-72 object-cover" />
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-100 truncate">{props.imageFile.name}</div>
                <div className="text-[10px] text-gray-400">
                  {(props.imageFile.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onFileChange(null)}
                className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
              >
                <X className="w-4 h-4 mr-2" />
                Remove
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModelStyleSection(props: {
  baseModel: BaseModel;
  stylePreset: StylePreset;
  onBaseModelChange: (model: BaseModel) => void;
  onStylePresetChange: (preset: StylePreset) => void;
}) {
  const baseModels: { id: BaseModel; label: string }[] = [
    { id: "feminine", label: "Feminine" },
    { id: "masculine", label: "Masculine" },
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
        <CardDescription className="text-xs text-gray-300">
          SDXL core model (bigLust_v16) with body-specific LoRA shaping.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
                      : "border-gray-800 bg-gray-950 text-gray-300 hover:border-gray-700"
                  }`}
                >
                  {bm.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold mb-2 text-gray-200">Style Preset</p>
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

function LoraIdentitySection(props: {
  value: LoraSelection;
  onChange: (next: LoraSelection) => void;
  options: { id: string; label: string }[];
}) {
  const v = props.value;
  const hasIdentity = v.selected.length > 0;

  const setSelected = (id: string) =>
    props.onChange({
      ...v,
      mode: "single",
      selected: id === "none" ? [] : [id],
      createNew: false,
      newName: "",
    });

  return (
    <Card className="border-purple-900/60 bg-gray-900/80 shadow-[0_0_24px_rgba(168,85,247,0.12)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base">Identity Control</CardTitle>
        <CardDescription className="text-xs text-gray-300">
          Use a trained identity LoRA to keep the same person consistent across generations and video.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {props.options.length === 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-[11px] text-gray-300">
            No trained LoRAs yet. Create one on{" "}
            <span className="text-gray-100 font-semibold">/lora/train</span>{" "}
            then come back to select it here.
          </div>
        )}

        <Select value={v.selected[0] || "none"} onValueChange={setSelected}>
          <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs text-gray-100">
            <SelectValue placeholder="Select identity LoRA" />
          </SelectTrigger>
          <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
            {props.options.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!hasIdentity && (
          <div className="rounded-lg border border-purple-900/50 bg-purple-500/5 px-3 py-2 text-[11px] text-gray-300">
            <span className="text-purple-300 font-semibold">New here?</span>{" "}
            Generate once, then train an identity LoRA for more consistent results across images and video.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

  const resolutions = ["1024x1024", "832x1216", "1024x1536", "1216x832", "1536x1024"];

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
          className="w-full justify-between px-0 hover:bg-transparent text-gray-100 hover:text-white"
        >
          <CardTitle className="text-sm md:text-base">Advanced Settings</CardTitle>
          {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
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
              <div>
                <p className="font-semibold mb-1 text-gray-200">Resolution</p>
                <Select value={props.resolution} onValueChange={props.onResolutionChange}>
                  <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs text-gray-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
                    {resolutions.map((res) => (
                      <SelectItem key={res} value={res}>
                        {res}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-gray-400 mt-1">SDXL max 1024x1792.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">CFG / Guidance Scale</p>
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
                  onChange={(e) => props.onGuidanceChange(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Steps</p>
                  <span className="text-[11px] text-purple-300 font-semibold">{props.steps}</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={75}
                  step={1}
                  value={props.steps}
                  onChange={(e) => props.onStepsChange(parseInt(e.target.value, 10) || 20)}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div>
                <p className="font-semibold mb-1 text-gray-200">Seed</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={props.seed}
                    onChange={(e) => props.onSeedChange(parseInt(e.target.value, 10) || 0)}
                    className="bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 h-8 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={randomizeSeed}
                    className="border-gray-700 bg-gray-950 text-gray-100 hover:bg-gray-900 h-8 w-8"
                  >
                    <Sparkles className="w-4 h-4" />
                  </Button>
                </div>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={props.lockSeed}
                    onChange={(e) => props.onLockSeedChange(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-700 bg-gray-950 accent-purple-500"
                  />
                  <span className="text-xs text-gray-300">Lock seed for reproducible outputs.</span>
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Batch Size</p>
                  <span className="text-[11px] text-purple-300 font-semibold">{props.batchSize}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={props.batchSize}
                  onChange={(e) =>
                    props.onBatchSizeChange(Math.max(1, parseInt(e.target.value, 10) || 1))
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

function VideoSettings(props: {
  duration: number;
  fps: number;
  motion: number;
  batchSize: number;
  onDurationChange: (value: number) => void;
  onFpsChange: (value: number) => void;
  onMotionChange: (value: number) => void;
  onBatchSizeChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="py-3">
        <Button
          variant="ghost"
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full justify-between px-0 hover:bg-transparent text-gray-100 hover:text-white"
        >
          <CardTitle className="text-sm md:text-base">Video Settings</CardTitle>
          {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
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
              <div className="rounded-lg border border-cyan-900/50 bg-cyan-500/5 px-3 py-2 text-[11px] text-gray-300">
                Best results: use an identity LoRA for more consistent character motion across frames.
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Duration</p>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {props.duration}s
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={25}
                  step={1}
                  value={props.duration}
                  onChange={(e) => props.onDurationChange(parseInt(e.target.value, 10) || 10)}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div>
                <p className="font-semibold mb-1 text-gray-200">FPS</p>
                <div className="grid grid-cols-3 gap-2">
                  {[12, 24, 30].map((fpsOption) => (
                    <button
                      key={fpsOption}
                      type="button"
                      onClick={() => props.onFpsChange(fpsOption)}
                      className={`rounded-lg px-3 py-2 text-[11px] font-medium ${
                        props.fps === fpsOption
                          ? "bg-purple-500 text-white"
                          : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      {fpsOption} fps
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Motion Strength</p>
                  <span className="text-[11px] text-purple-300 font-semibold">
                    {props.motion.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={props.motion}
                  onChange={(e) => props.onMotionChange(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-gray-200">Batch Size</p>
                  <span className="text-[11px] text-purple-300 font-semibold">{props.batchSize}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={props.batchSize}
                  onChange={(e) =>
                    props.onBatchSizeChange(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                  className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Video batch is visible now for launch planning. Final tier enforcement should remain backend-side.
                </p>
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function GenerateButton(props: {
  mode: GenerationMode;
  isGenerating: boolean;
  batchSize: number;
  qualityPreset: QualityPreset;
  consistencyPreset: ConsistencyPreset;
  disabled?: boolean;
  onClick: () => void;
}) {
  const actionLabel =
    props.mode === "image_to_video"
      ? "Generate Video"
      : props.mode === "text_to_video"
      ? "Generate Cinematic Video"
      : "Generate";

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
                ? "bg-gray-700 text-gray-300 cursor-not-allowed"
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
                {actionLabel}
              </span>
            )}
          </Button>
        </motion.div>
        <p className="text-[11px] text-gray-300 text-center mt-2">{subtext}</p>
      </CardContent>
    </Card>
  );
}

function OutputPanel(props: { items: GeneratedItem[]; loading: boolean }) {
  const [selected, setSelected] = useState<GeneratedItem | null>(null);

  if (props.loading) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">Generating…</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square rounded-xl bg-gray-800 animate-pulse" />
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
          <p className="text-xs text-gray-400">
            Describe something on the left and press Generate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">Latest Generation</h2>
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
                <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" />
              ) : (
                <video src={item.url} className="w-full h-full object-cover" controls={false} muted loop />
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
                <img src={selected.url} alt={selected.prompt} className="w-full h-auto" />
              ) : (
                <video src={selected.url} className="w-full h-auto" controls autoPlay muted loop />
              )}
              <div className="p-4 space-y-2 text-xs">
                <p className="text-gray-300">{selected.prompt}</p>
                <p className="text-[10px] text-gray-400">
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
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M5 20h14v-2H5v2zm7-3 5-5h-3V4h-4v8H7l5 5z"
        fill="currentColor"
      />
    </svg>
  );
}

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
      const matchesQuery = item.prompt.toLowerCase().includes(query.toLowerCase());
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
      <h3 className="text-sm md:text-base font-bold text-gray-100">Session History</h3>

      <div className="space-y-2 text-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <Input
            placeholder="Filter by prompt…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 h-8 text-xs"
          />
        </div>

        <div className="flex gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "images" | "videos")}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="images">Images</SelectItem>
              <SelectItem value="videos">Videos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as "newest" | "oldest")}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-8 text-xs text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
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
              <img src={item.url} alt={item.prompt} className="w-12 h-12 rounded object-cover" />
            ) : (
              <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center">
                <VideoIcon className="w-5 h-5 text-purple-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-gray-100 line-clamp-2">{item.prompt}</p>
              <p className="text-[10px] text-gray-400 mt-1">
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
              className="shrink-0 h-7 w-7 text-gray-100 hover:text-white"
            >
              <Play className="w-3.5 h-3.5" />
            </Button>
          </motion.div>
        ))}
      </div>

      {!filtered.length && (
        <div className="text-center py-8 text-[11px] text-gray-400">
          No history this session yet.
        </div>
      )}
    </div>
  );
}

export default function GeneratePage() {
  const router = useRouter();

  const [mode, setMode] = useState<GenerationMode>("text_to_image");
  const [outputType, setOutputType] = useState<"IMAGE" | "STORY">("IMAGE");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    "cartoon, 3d, render, low res, low resolution, blurry, poor quality, jpeg artifacts, cgi, bad anatomy, deformed, extra fingers, extra limbs"
  );
  const [identityOptions, setIdentityOptions] = useState<
    { id: string; name: string | null }[]
  >([]);

  const [baseModel, setBaseModel] = useState<BaseModel>("feminine");
  const [stylePreset, setStylePreset] = useState<StylePreset>("photorealistic");
  const [qualityPreset] = useState<QualityPreset>("balanced");
  const [consistencyPreset] = useState<ConsistencyPreset>("medium");

  const [loraSelection, setLoraSelection] = useState<LoraSelection>({
    mode: "single",
    selected: [],
    createNew: false,
    newName: "",
  });

  const [resolution, setResolution] = useState("1024x1024");
  const [guidance, setGuidance] = useState(7.5);
  const [steps, setSteps] = useState(30);
  const [seed, setSeed] = useState(0);
  const [lockSeed, setLockSeed] = useState(false);
  const [batchSize, setBatchSize] = useState(1);

  const [videoDuration, setVideoDuration] = useState(10);
  const [videoFps, setVideoFps] = useState(24);
  const [videoMotion, setVideoMotion] = useState(0.45);
  const [videoBatchSize, setVideoBatchSize] = useState(1);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [history, setHistory] = useState<GeneratedItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showSubModal, setShowSubModal] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const canGenerate =
    !isGenerating &&
    (
      mode === "image_to_video"
        ? Boolean(imageFile)
        : Boolean(prompt?.trim())
    ) &&
    Boolean(baseModel);

  useEffect(() => {
    let cancelled = false;

    const loadIdentities = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user?.id) {
          if (!cancelled) setIdentityOptions([]);
          return;
        }

        const { data, error } = await supabase
          .from("user_loras")
          .select("id, name")
          .eq("user_id", session.user.id)
          .eq("status", "completed")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Failed to load user LoRAs:", error);
          if (!cancelled) setIdentityOptions([]);
          return;
        }

        if (!cancelled) setIdentityOptions(data ?? []);
      } catch (err) {
        console.error("Identity load crash:", err);
        if (!cancelled) setIdentityOptions([]);
      }
    };

    loadIdentities();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) loadIdentities();
    });

    const handler = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const detail = (ce as any)?.detail ?? {};

      const incomingPrompt = typeof detail.prompt === "string" ? detail.prompt : "";
      const incomingNegative =
        typeof detail.negative_prompt === "string" ? detail.negative_prompt : "";

      if (incomingPrompt) setPrompt(incomingPrompt);
      if (incomingNegative) setNegativePrompt(incomingNegative);

      const otRaw = typeof detail.output_type === "string" ? detail.output_type : "";
      const ot = otRaw.trim().toUpperCase();
      if (ot === "STORY") {
        setOutputType("STORY");
      } else if (ot === "IMAGE") {
        setOutputType("IMAGE");
      }

      setMode("text_to_image");
    };

    window.addEventListener("siren_mind_generate", handler as EventListener);
    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
      window.removeEventListener("siren_mind_generate", handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  const identitySelectOptions: { id: string; label: string }[] = [
    { id: "none", label: "None (no identity LoRA)" },
    ...identityOptions.map((l) => ({
      id: l.id,
      label: l.name && l.name.trim().length > 0 ? l.name : l.id,
    })),
  ];

  const handleGenerate = async () => {
    const bodyModeMap: Record<string, string> = {
      feminine: "body_feminine",
      masculine: "body_masculine",
    };

    const selectedLoraId = loraSelection.selected[0] ?? null;

    setErrorMessage(null);
    setIsGenerating(true);

    const [parsedWidth, parsedHeight] = resolution
      .split("x")
      .map((v) => parseInt(v, 10));

    try {
      const seedValue = lockSeed ? seed : Math.floor(Math.random() * 1_000_000_000);

      const baseParams = {
        engine: "comfyui",
        template: "sirens_image_v3_production",
        prompt,
        negative_prompt: negativePrompt,
        body_mode: bodyModeMap[baseModel],
        width: parsedWidth,
        height: parsedHeight,
        steps,
        cfg: guidance,
        seed: seedValue,
        identity_lora: selectedLoraId ? selectedLoraId : null,
      };

      const runCount =
        mode === "text_to_image"
          ? Math.max(1, batchSize || 1)
          : Math.max(1, videoBatchSize || 1);

      const generatedAll: GeneratedItem[] = [];

      for (let i = 0; i < runCount; i++) {
        const runSeed = lockSeed ? seedValue + i : Math.floor(Math.random() * 1_000_000_000);

        if (mode === "text_to_image") {
          const runPayload = {
            ...baseParams,
            seed: runSeed,
          };

          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(runPayload),
          });

          if (res.status === 402 || res.status === 403) {
            let reason = "You need an active SirensForge subscription to use the generator.";
            try {
              const data = await res.json();
              if (typeof data?.error === "string") reason = data.error;
              else if (typeof data?.message === "string") reason = data.message;
              else if (typeof data?.code === "string") reason = data.code;
            } catch {}
            setSubscriptionError(reason);
            setShowSubModal(true);
            setIsGenerating(false);
            return;
          }

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Generate failed (${res.status}): ${text || "Unknown error"}`);
          }

          const data = await res.json();
          const outputs = Array.isArray(data?.images)
            ? data.images
            : Array.isArray(data?.outputs)
            ? data.outputs
            : [];

          if (!outputs.length) {
            throw new Error("/api/generate did not return images[] or outputs[].");
          }

          const now = new Date().toISOString();
          const generated: GeneratedItem[] = outputs.map((output: any) => ({
            id: `${now}-${Math.random().toString(36).slice(2)}`,
            kind: inferKindFromOutput(output),
            url: getOutputUrl(output),
            prompt,
            settings: runPayload,
            createdAt: now,
          }));

          generatedAll.push(...generated);
        } else {
          const videoPayload = {
            ...baseParams,
            mode,
            seed: runSeed,
            image_input:
              mode === "image_to_video" && imageFile
                ? {
                    filename: imageFile.name,
                    data_url: await fileToDataUrl(imageFile),
                  }
                : null,
            video: {
              duration: videoDuration,
              fps: videoFps,
              motion: videoMotion,
              batch: 1,
            },
          };

          const res = await fetch("/api/generate_video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(videoPayload),
          });

          if (res.status === 402 || res.status === 403) {
            let reason = "You need an active SirensForge subscription to use the generator.";
            try {
              const data = await res.json();
              if (typeof data?.error === "string") reason = data.error;
              else if (typeof data?.message === "string") reason = data.message;
              else if (typeof data?.code === "string") reason = data.code;
            } catch {}
            setSubscriptionError(reason);
            setShowSubModal(true);
            setIsGenerating(false);
            return;
          }

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`Video generate failed (${res.status}): ${text || "Unknown error"}`);
          }

          const data = await res.json();
          const outputs = Array.isArray(data?.outputs)
            ? data.outputs
            : data?.video_url
            ? [data.video_url]
            : [];

          if (!outputs.length) {
            throw new Error("/api/generate_video did not return outputs[] or video_url.");
          }

          const now = new Date().toISOString();
          const generated: GeneratedItem[] = outputs.map((output: any) => ({
            id: `${now}-${Math.random().toString(36).slice(2)}`,
            kind: "video",
            url: getOutputUrl(output),
            prompt: prompt || "(Image-driven video)",
            settings: videoPayload,
            createdAt: now,
          }));

          generatedAll.push(...generated);
        }
      }

      if (!generatedAll.length) {
        throw new Error("Generation returned no outputs.");
      }

      setItems((prev) => [...generatedAll, ...prev].slice(0, 12));
      setHistory((prev) => [...generatedAll, ...prev]);
    } catch (err: any) {
      console.error("Generation error:", err);

      const fallback =
        outputType === "IMAGE"
          ? "Something went wrong generating your output. Check backend logs."
          : "Something went wrong generating your story. Check backend logs.";

      setErrorMessage(err?.message || fallback);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleHistorySelect = (item: GeneratedItem) => {
    setPrompt(item.prompt);
  };

  const handleHistoryRerun = (item: GeneratedItem) => {
    setPrompt(item.prompt);
    handleGenerate();
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 flex flex-col">
      <GeneratorHeader activeMode={mode} />

      <main className="flex-1 flex flex-col md:flex-row">
        <div className="flex-1 px-4 md:px-6 py-4 md:py-6 space-y-4 max-w-6xl mx-auto w-full">
          <ModeTabs activeMode={mode} onChange={setMode} />

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="space-y-4 xl:col-span-1">
              {mode === "image_to_video" && (
                <ImageToVideoUploadSection
                  imageFile={imageFile}
                  previewUrl={imagePreviewUrl}
                  onFileChange={setImageFile}
                />
              )}

              <LoraIdentitySection
                value={loraSelection}
                onChange={(next) => setLoraSelection(next)}
                options={identitySelectOptions}
              />

              <PromptSection
                mode={mode}
                prompt={prompt}
                negativePrompt={negativePrompt}
                onPromptChange={setPrompt}
                onNegativePromptChange={setNegativePrompt}
              />

              <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-[11px] text-gray-300">
                <div className="font-semibold text-gray-100">Ultra add-on</div>
                <div className="mt-1">
                  Type{" "}
                  <span className="font-mono text-gray-100">(d1ldo)</span> anywhere in your prompt to enable the dildo-play add-on.
                  Helpful words: small dildo, medium dildo, big dildo, on back, on side, doggystyle, ass, close-up,
                  masturbation, vaginal.
                </div>
              </div>
            </div>

            <div className="space-y-4 xl:col-span-1">
              <ModelStyleSection
                baseModel={baseModel}
                stylePreset={stylePreset}
                onBaseModelChange={setBaseModel}
                onStylePresetChange={setStylePreset}
              />

              {mode === "text_to_image" ? (
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
              ) : (
                <VideoSettings
                  duration={videoDuration}
                  fps={videoFps}
                  motion={videoMotion}
                  batchSize={videoBatchSize}
                  onDurationChange={setVideoDuration}
                  onFpsChange={setVideoFps}
                  onMotionChange={setVideoMotion}
                  onBatchSizeChange={setVideoBatchSize}
                />
              )}

              <GenerateButton
                mode={mode}
                isGenerating={isGenerating}
                batchSize={mode === "text_to_image" ? batchSize : videoBatchSize}
                qualityPreset={qualityPreset}
                consistencyPreset={consistencyPreset}
                disabled={!canGenerate}
                onClick={handleGenerate}
              />

              {errorMessage && <p className="text-[11px] text-red-400">{errorMessage}</p>}
            </div>

            <div className="space-y-4 xl:col-span-1">
              <Card className="border-gray-800 bg-gray-900/80 h-full">
                <CardContent className="p-4 h-full">
                  <OutputPanel items={items} loading={isGenerating} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l border-gray-900">
          <HistorySidebar history={history} onSelect={handleHistorySelect} onRerun={handleHistoryRerun} />
        </div>
      </main>

      <SubscriptionModal
        open={showSubModal}
        message={subscriptionError}
        onClose={() => setShowSubModal(false)}
        onGoPricing={() => router.push("/pricing")}
      />
    </div>
  );
}
