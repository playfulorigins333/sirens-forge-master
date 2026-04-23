"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  CheckCircle2,
  Copy,
  UserPlus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
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

const SIREN_MIND_HANDOFF_STORAGE_KEY = "sirensforge:siren_mind_handoff";
const DEFAULT_NEGATIVE_PROMPT =
  "cartoon, 3d, render, low res, low resolution, blurry, poor quality, jpeg artifacts, cgi, bad anatomy, deformed, extra fingers, extra limbs";

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
type RefineVariant = "cinematic" | "explicit" | "photoreal";

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

type HandoffPayload = {
  prompt?: string;
  negative_prompt?: string;
  output_type?: string;
  generation_target?: string;
  created_at?: number;
  source?: string;
};

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

function parseGenerationMode(input?: string | null): GenerationMode {
  const gt = String(input || "")
    .trim()
    .toLowerCase();

  if (
    gt === "image_to_video" ||
    gt === "image-to-video" ||
    gt === "image to video"
  ) {
    return "image_to_video";
  }

  if (
    gt === "text_to_video" ||
    gt === "text-to-video" ||
    gt === "text to video" ||
    gt === "video"
  ) {
    return "text_to_video";
  }

  return "text_to_image";
}

function modeLabel(mode: GenerationMode): string {
  switch (mode) {
    case "image_to_video":
      return "Image → Video";
    case "text_to_video":
      return "Text → Video";
    default:
      return "Text → Image";
  }
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
          className="relative mx-4 w-full max-w-lg"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <div className="absolute -inset-[2px] animate-pulse rounded-3xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-80 blur-sm" />
          <div className="relative overflow-hidden rounded-3xl border border-purple-700/60 bg-gray-950/95 shadow-[0_0_40px_rgba(168,85,247,0.6)]">
            <div className="flex items-center gap-3 border-b border-purple-900/50 px-6 pb-4 pt-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-cyan-500 text-black shadow-lg">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-lg font-bold text-transparent">
                  Subscription Required to Forge
                </h2>
                <p className="mt-0.5 text-xs text-gray-300">
                  Generator access is locked to SirensForge members. OG &amp;
                  Early Bird tiers get full image &amp; video generation.
                </p>
              </div>
            </div>

            <div className="space-y-3 px-6 py-4 text-sm text-gray-200">
              {message && (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {message}
                </p>
              )}

              <p className="text-xs text-gray-300">
                To keep the platform fast, exclusive, and creator-first, the
                Forge is currently limited to paid members:
              </p>

              <ul className="space-y-1.5 text-xs text-gray-300">
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

              <p className="pt-1 text-[11px] text-gray-400">
                You&apos;re seeing this message because your account doesn&apos;t
                have an active tier with generator access yet.
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-purple-900/40 bg-gradient-to-r from-purple-950/60 via-black to-cyan-950/40 px-6 pb-5 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[11px] text-gray-300">
                <p>
                  Smash the competition at launch by locking in{" "}
                  <span className="font-semibold text-purple-300">OG</span> or{" "}
                  <span className="font-semibold text-pink-300">Early Bird</span>{" "}
                  access before seats are gone.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-9 border-gray-700 bg-gray-900 px-3 text-xs text-gray-200"
                >
                  Stay on this page
                </Button>
                <Button
                  type="button"
                  onClick={onGoPricing}
                  className="h-9 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 px-4 text-xs font-semibold text-black shadow-[0_0_20px_rgba(168,85,247,0.8)] hover:from-purple-400 hover:via-pink-400 hover:to-cyan-400"
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
    <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-950/70 backdrop-blur">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-2xl font-bold text-transparent">
            SirensForge Generator
          </h1>
          <p className="mt-1 text-xs text-gray-300 md:text-sm">{subtitle}</p>
        </div>

        <div className="flex items-center gap-4">
          {badgeConfig && (
            <div
              className={`hidden items-center gap-2 rounded-full bg-gradient-to-r px-3 py-1.5 text-xs font-bold text-white sm:flex ${badgeConfig.color}`}
            >
              <badgeConfig.icon className="h-3 w-3" />
              {badgeConfig.text}
            </div>
          )}

          <div
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              subscriptionStatus === "active"
                ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                : "border border-gray-700 bg-gray-800 text-gray-300"
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
            <span className="hidden text-sm font-medium text-gray-100 md:block">
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
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = props.activeMode === mode.id;
        return (
          <motion.button
            key={mode.id}
            onClick={() => props.onChange(mode.id)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`relative rounded-xl border-2 p-3 transition-all ${
              isActive
                ? "border-purple-500 bg-purple-500/10"
                : "border-gray-800 bg-gray-900/70 hover:border-gray-700"
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              <Icon
                className={`h-5 w-5 ${
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

function HandoffArrivalBanner(props: {
  visible: boolean;
  mode: GenerationMode;
  onDismiss: () => void;
}) {
  if (!props.visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-fuchsia-500/20 bg-[linear-gradient(180deg,rgba(32,15,45,0.55),rgba(11,10,16,0.9))] p-4 shadow-[0_0_30px_rgba(192,38,211,0.12)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500/25 via-fuchsia-500/25 to-cyan-500/25 text-fuchsia-200">
            <CheckCircle2 className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              Prompt imported from A Siren’s Mind
            </div>
            <div className="mt-1 text-xs text-zinc-300">
              Mode detected:{" "}
              <span className="font-semibold text-fuchsia-200">
                {modeLabel(props.mode)}
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-5 text-zinc-400">
              Review your prompt, choose a LoRA if you want one, adjust settings,
              then generate when you’re ready.
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={props.onDismiss}
          className="h-8 shrink-0 px-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          Dismiss
        </Button>
      </div>
    </motion.div>
  );
}


function HandoffConfidencePanel(props: {
  visible: boolean;
  mode: GenerationMode;
  selectedIdentityLabel: string;
  prompt: string;
  onPromptChange: (value: string) => void;
}) {
  if (!props.visible) return null;

  const suggestionChips =
    props.mode === "text_to_image"
      ? [
          {
            label: "More photorealistic",
            addition: "photorealistic, realistic skin texture, natural lighting, lifelike detail",
          },
          {
            label: "More cinematic",
            addition: "cinematic composition, dramatic lighting, filmic mood, premium visual storytelling",
          },
          {
            label: "Sharpen anatomy",
            addition: "accurate anatomy, proportional body structure, natural hands, clean body detail",
          },
          {
            label: "More explicit",
            addition: "more explicit sexual detail, stronger erotic intensity, bolder sensual focus",
          },
        ]
      : [
          {
            label: "More motion",
            addition: "stronger motion, more dynamic movement, visible body motion",
          },
          {
            label: "More cinematic lighting",
            addition: "cinematic lighting, moody highlights, dramatic contrast, filmic glow",
          },
          {
            label: "Slower pacing",
            addition: "slow sensual pacing, controlled movement, unhurried rhythm",
          },
          {
            label: "Stronger camera movement",
            addition: "stronger camera movement, smooth dolly motion, cinematic camera drift",
          },
        ];

  const applySuggestion = (addition: string) => {
    const trimmedPrompt = props.prompt.trim();
    const trimmedAddition = addition.trim();

    if (!trimmedPrompt) {
      props.onPromptChange(trimmedAddition);
      return;
    }

    const normalizedPrompt = trimmedPrompt.toLowerCase();
    const normalizedAddition = trimmedAddition.toLowerCase();

    if (normalizedPrompt.includes(normalizedAddition)) {
      return;
    }

    props.onPromptChange(`${trimmedPrompt}, ${trimmedAddition}`);
  };

  return (
    <Card className="border-fuchsia-500/20 bg-[linear-gradient(180deg,rgba(24,14,34,0.92),rgba(10,10,14,0.96))] shadow-[0_0_30px_rgba(192,38,211,0.08)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Sparkles className="h-4 w-4 text-fuchsia-300" />
          Ready to Generate
        </CardTitle>
        <CardDescription className="text-xs text-zinc-300">
          Quick status check before you hit Generate.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-fuchsia-500/20 bg-black/30 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Mode
            </div>
            <div className="mt-1 text-sm font-semibold text-white">
              {modeLabel(props.mode)}
            </div>
          </div>

          <div className="rounded-xl border border-fuchsia-500/20 bg-black/30 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Identity
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white">
              {props.selectedIdentityLabel}
            </div>
          </div>

          <div className="rounded-xl border border-fuchsia-500/20 bg-black/30 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Prompt source
            </div>
            <div className="mt-1 text-sm font-semibold text-white">
              A Siren’s Mind
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Smart Suggestions
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestionChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => applySuggestion(chip.addition)}
                className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/8 px-3 py-1.5 text-[11px] font-medium text-fuchsia-100 transition-all hover:border-fuchsia-400/40 hover:bg-fuchsia-500/15 hover:text-white"
              >
                + {chip.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getPromptStrengthScore(prompt: string): number {
  const text = prompt.toLowerCase();

  let score = 0;

  // LENGTH
  if (text.length > 40) score += 1;
  if (text.length > 100) score += 1;
  if (text.length > 180) score += 1;

  // SUBJECT DETAIL
  if (/(woman|man|girl|boy|subject|figure|person|character)/.test(text)) score += 1;
  if (/(eyes|lips|hair|face|body|skin|physique|curves|features)/.test(text)) score += 1;

  // CLOTHING / STYLE
  if (/(dress|lingerie|outfit|clothing|fashion|style|sheer|lace|leather)/.test(text)) score += 1;

  // POSE / ACTION
  if (/(posing|posed|standing|sitting|lying|leaning|movement|motion|gaze)/.test(text)) score += 1;

  // ENVIRONMENT
  if (/(room|studio|background|environment|scene|location|backdrop|setting)/.test(text)) score += 1;

  // LIGHTING
  if (/(lighting|light|glow|shadows|golden hour|neon|dramatic|rim light|soft light)/.test(text)) score += 1;

  // CAMERA / COMPOSITION
  if (/(camera|angle|depth of field|close up|close-up|portrait|wide shot|framing|composition)/.test(text)) score += 1;

  // REALISM / TEXTURE
  if (/(realistic|photorealistic|texture|skin detail|high detail|lifelike|natural)/.test(text)) score += 1;

  // MOOD / TONE
  if (/(moody|sensual|erotic|dark|cinematic|atmosphere|sultry|seductive)/.test(text)) score += 1;

  return score;
}

function evaluatePromptStrength(prompt: string) {
  const score = getPromptStrengthScore(prompt);

  if (score <= 3) {
    return {
      label: "Weak",
      color: "bg-red-500",
      hint: "Add subject detail, environment, and lighting.",
      percent: 25,
    };
  }

  if (score <= 6) {
    return {
      label: "Decent",
      color: "bg-yellow-500",
      hint: "Good start. Add composition, lighting, and realism.",
      percent: 50,
    };
  }

  if (score <= 9) {
    return {
      label: "Strong",
      color: "bg-green-500",
      hint: "Well-structured prompt. Minor refinements can push it further.",
      percent: 75,
    };
  }

  return {
    label: "Elite",
    color: "bg-gradient-to-r from-purple-500 to-cyan-500",
    hint: "Highly refined, production-ready prompt.",
    percent: 100,
  };
}

function SirensMindCTA(props: { onOpen: () => void }) {
  return (
    <Card className="border-fuchsia-500/20 bg-[linear-gradient(180deg,rgba(24,14,34,0.92),rgba(10,10,14,0.96))] shadow-[0_0_30px_rgba(192,38,211,0.08)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Sparkles className="h-4 w-4 text-fuchsia-300" />
          A Siren’s Mind
        </CardTitle>
        <CardDescription className="text-xs text-zinc-300">
          Turn rough ideas into polished, generator-ready prompts with AI guidance before you generate.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Button
          type="button"
          onClick={props.onOpen}
          className="h-10 w-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-xs font-semibold text-white hover:brightness-110"
        >
          Open Siren’s Mind
        </Button>
      </CardContent>
    </Card>
  );
}

function PromptSection(props: {
  mode: GenerationMode;
  prompt: string;
  negativePrompt: string;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  onRefine: (variant: RefineVariant) => void;
  refiningVariant: RefineVariant | null;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  highlight?: boolean;
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
    <Card
      className={`border-gray-800 bg-gray-900/80 transition-all duration-500 ${
        props.highlight
          ? "border-fuchsia-400/50 shadow-[0_0_0_1px_rgba(232,121,249,0.25),0_0_34px_rgba(192,38,211,0.18)]"
          : ""
      }`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Sparkles className="h-5 w-5 text-purple-400" />
          Prompt Builder
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Textarea
            ref={props.textareaRef}
            value={props.prompt}
            onChange={(e) => props.onPromptChange(e.target.value)}
            placeholder={placeholder}
            className={`min-h-32 resize-none border-gray-700 bg-gray-950 text-sm text-gray-100 placeholder:text-gray-500 transition-all ${
              props.highlight ? "ring-1 ring-fuchsia-400/35" : ""
            }`}
          />
          <p className="mt-1 text-[10px] text-gray-400">
            {props.prompt.length} characters
          </p>

          
<div className="mt-3">
  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-300">
    AI Refine Modes
  </div>
  <div className="text-[10px] text-zinc-400 mb-2">
    Choose how Siren’s Mind should rewrite your prompt
  </div>
</div>

<div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">

            <button
              type="button"
              onClick={() => props.onRefine("cinematic")}
              disabled={props.refiningVariant !== null}
              className="rounded-lg border border-fuchsia-500/20 bg-gradient-to-r from-purple-500/90 via-fuchsia-500/90 to-cyan-500/90 px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.refiningVariant === "cinematic" ? "Refining..." : "🎬 Cinematic"}
            </button>

            <button
              type="button"
              onClick={() => props.onRefine("explicit")}
              disabled={props.refiningVariant !== null}
              className="rounded-lg border border-fuchsia-500/20 bg-gradient-to-r from-rose-500/90 via-pink-500/90 to-fuchsia-500/90 px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.refiningVariant === "explicit" ? "Refining..." : "🔥 Explicit"}
            </button>

            <button
              type="button"
              onClick={() => props.onRefine("photoreal")}
              disabled={props.refiningVariant !== null}
              className="rounded-lg border border-fuchsia-500/20 bg-gradient-to-r from-cyan-500/90 via-sky-500/90 to-blue-500/90 px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {props.refiningVariant === "photoreal" ? "Refining..." : "📸 Photoreal"}
            </button>
          </div>

          {props.prompt.trim().length > 0 && (() => {
            const strength = evaluatePromptStrength(props.prompt);

            return (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-400">Prompt Strength</span>
                  <span className="font-semibold text-white">{strength.label}</span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={`h-full transition-all duration-500 ${strength.color}`}
                    style={{ width: `${strength.percent}%` }}
                  />
                </div>

                <div className="text-[10px] text-gray-400">{strength.hint}</div>
              </div>
            );
          })()}
          <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-[11px] text-gray-300">
            Tip: Describe the subject clearly for better repeatability. Example:{" "}
            <span className="font-medium text-gray-100">
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
              className="rounded-full bg-gray-800 px-3 py-1.5 text-[11px] text-gray-200 transition-colors hover:bg-purple-500/20 hover:text-purple-200"
            >
              + {chip}
            </button>
          ))}
        </div>

        <Button
          type="button"
          onClick={() => setShowNegative((v) => !v)}
          className="w-full justify-between border border-gray-800 bg-gray-950 text-xs text-gray-100 hover:bg-gray-900 hover:text-white"
        >
          <span>Refine & filter (negative prompt) ✨</span>
          {showNegative ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                className="mt-2 min-h-24 resize-none border-gray-700 bg-gray-950 text-sm text-gray-100 placeholder:text-gray-500"
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
          <Upload className="h-5 w-5 text-cyan-400" />
          Source Image
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          Upload the image you want to animate into motion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!props.imageFile ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-700 bg-gray-950 px-4 py-8 text-center transition-colors hover:border-purple-500/60">
            <Upload className="h-7 w-7 text-purple-400" />
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
          <div className="space-y-3 rounded-xl border border-gray-800 bg-gray-950 p-3">
            {props.previewUrl && (
              <img src={props.previewUrl} alt="Upload preview" className="max-h-72 w-full rounded-lg object-cover" />
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-gray-100">{props.imageFile.name}</div>
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
                <X className="mr-2 h-4 w-4" />
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
      <CardHeader className="pb-2">
        <CardTitle className="text-sm md:text-base">Model & Style</CardTitle>
        <CardDescription className="text-[11px] text-gray-400">
          Body type + style preset.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-300">
            Body Type
          </p>
          <div className="grid grid-cols-2 gap-2">
            {baseModels.map((bm) => {
              const isActive = props.baseModel === bm.id;
              return (
                <button
                  key={bm.id}
                  type="button"
                  onClick={() => props.onBaseModelChange(bm.id)}
                  className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold transition-all ${
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
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-300">
            Style
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stylePresets.map((preset) => {
              const isActive = props.stylePreset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => props.onStylePresetChange(preset)}
                  className={`rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-all ${
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

  const setSelected = (id: string) =>
    props.onChange({
      ...v,
      mode: "single",
      selected: id === "none" ? [] : [id],
      createNew: false,
      newName: "",
    });

  return (
    <Card className="border-purple-900/60 bg-gray-900/80 shadow-[0_0_16px_rgba(168,85,247,0.10)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm md:text-base">Identity</CardTitle>
        <CardDescription className="text-[11px] text-gray-400">
          Select your trained LoRA.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2 pt-0 text-xs">
        <Select value={v.selected[0] || "none"} onValueChange={setSelected}>
          <SelectTrigger className="h-9 border-gray-800 bg-gray-950 text-xs text-gray-100">
            <SelectValue placeholder="Select identity LoRA" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-950 text-gray-100">
            {props.options.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {props.options.length === 0 && (
          <p className="text-[10px] leading-5 text-gray-400">
            No trained LoRAs yet. Create one on <span className="font-semibold text-gray-200">/lora/train</span>.
          </p>
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
          className="w-full justify-between px-0 text-gray-100 hover:bg-transparent hover:text-white"
        >
          <CardTitle className="text-sm md:text-base">Advanced Settings</CardTitle>
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </Button>
      </CardHeader>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <CardContent className="space-y-4 pb-4 pt-0 text-xs">
              <div>
                <p className="mb-1 font-semibold text-gray-200">Resolution</p>
                <Select value={props.resolution} onValueChange={props.onResolutionChange}>
                  <SelectTrigger className="h-8 border-gray-800 bg-gray-950 text-xs text-gray-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-gray-800 bg-gray-950 text-gray-100">
                    {resolutions.map((res) => (
                      <SelectItem key={res} value={res}>
                        {res}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-gray-400">SDXL max 1024x1792.</p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">CFG / Guidance Scale</p>
                  <span className="text-[11px] font-semibold text-purple-300">
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">Steps</p>
                  <span className="text-[11px] font-semibold text-purple-300">{props.steps}</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={75}
                  step={1}
                  value={props.steps}
                  onChange={(e) => props.onStepsChange(parseInt(e.target.value, 10) || 20)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
                />
              </div>

              <div>
                <p className="mb-1 font-semibold text-gray-200">Seed</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={props.seed}
                    onChange={(e) => props.onSeedChange(parseInt(e.target.value, 10) || 0)}
                    className="h-8 border-gray-700 bg-gray-950 text-xs text-gray-100 placeholder:text-gray-500"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={randomizeSeed}
                    className="h-8 w-8 border-gray-700 bg-gray-950 text-gray-100 hover:bg-gray-900"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={props.lockSeed}
                    onChange={(e) => props.onLockSeedChange(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-700 bg-gray-950 accent-purple-500"
                  />
                  <span className="text-xs text-gray-300">Lock seed for reproducible outputs.</span>
                </label>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">Batch Size</p>
                  <span className="text-[11px] font-semibold text-purple-300">{props.batchSize}</span>
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
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
          className="w-full justify-between px-0 text-gray-100 hover:bg-transparent hover:text-white"
        >
          <CardTitle className="text-sm md:text-base">Video Settings</CardTitle>
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </Button>
      </CardHeader>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <CardContent className="space-y-4 pb-4 pt-0 text-xs">
              <div className="rounded-lg border border-cyan-900/50 bg-cyan-500/5 px-3 py-2 text-[11px] text-gray-300">
                Best results: use an identity LoRA for more consistent character motion across frames.
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">Duration</p>
                  <span className="text-[11px] font-semibold text-purple-300">
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
                />
              </div>

              <div>
                <p className="mb-1 font-semibold text-gray-200">FPS</p>
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
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">Motion Strength</p>
                  <span className="text-[11px] font-semibold text-purple-300">
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-gray-200">Batch Size</p>
                  <span className="text-[11px] font-semibold text-purple-300">{props.batchSize}</span>
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
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-purple-500"
                />
                <p className="mt-1 text-[10px] text-gray-400">
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
            className={`h-12 w-full text-sm font-semibold transition-all md:text-base ${
              props.disabled || props.isGenerating
                ? "cursor-not-allowed bg-gray-700 text-gray-300"
                : "bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 shadow-lg shadow-purple-500/30 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
            }`}
          >
            {props.isGenerating ? (
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 animate-spin" />
                Generating…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {actionLabel}
              </span>
            )}
          </Button>
        </motion.div>
        <p className="mt-2 text-center text-[11px] text-gray-300">{subtext}</p>
      </CardContent>
    </Card>
  );
}


function RefineChoicesPanel(props: {
  choices: string[] | null;
  onApply: (value: string, index: number) => void;
  onGenerateRecommended: () => void;
  recommendedIndex: number | null;
  appliedIndex: number | null;
  generatingRecommended?: boolean;
}) {
  if (!props.choices || props.choices.length === 0) return null;

  const recommendedChoice =
    props.recommendedIndex !== null &&
    props.recommendedIndex >= 0 &&
    props.recommendedIndex < props.choices.length
      ? props.choices[props.recommendedIndex]
      : null;

  return (
    <Card className="border-cyan-500/20 bg-black/40 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-sm text-cyan-300 md:text-base">
              Choose Your Refined Prompt
            </CardTitle>
            <CardDescription className="mt-1 text-xs text-zinc-400">
              Option B is auto-applied as the recommended starting point. You can still swap to any option below.
            </CardDescription>
          </div>

          {recommendedChoice && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() =>
                  props.onApply(
                    recommendedChoice,
                    props.recommendedIndex ?? 0
                  )
                }
                variant="outline"
                className="h-8 border-fuchsia-400/30 bg-fuchsia-500/10 px-3 text-[11px] font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15 hover:text-white"
              >
                Use Recommended
              </Button>
              <Button
                type="button"
                onClick={props.onGenerateRecommended}
                disabled={props.generatingRecommended}
                className="h-8 bg-gradient-to-r from-fuchsia-500 via-pink-500 to-cyan-500 px-3 text-[11px] font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {props.generatingRecommended ? "Generating…" : "✨ Generate Recommended"}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {props.choices.map((choice, index) => {
          const isRecommended = props.recommendedIndex === index;
          const isApplied = props.appliedIndex === index;

          return (
            <button
              key={`${index}-${choice.slice(0, 24)}`}
              type="button"
              onClick={() => props.onApply(choice, index)}
              className={`w-full rounded-xl border px-4 py-3 text-left text-[12px] text-zinc-200 transition-all hover:text-white ${
                isRecommended
                  ? "border-fuchsia-400/50 bg-fuchsia-500/10 shadow-[0_0_0_1px_rgba(232,121,249,0.24),0_0_30px_rgba(217,70,239,0.16)] hover:border-fuchsia-300/60 hover:bg-fuchsia-500/14"
                  : "border-cyan-500/20 bg-black/30 hover:border-cyan-400/40 hover:bg-cyan-500/10"
              } ${
                isApplied
                  ? "ring-1 ring-cyan-300/40 shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_0_22px_rgba(34,211,238,0.12)]"
                  : ""
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  isRecommended ? "text-fuchsia-300" : "text-cyan-300"
                }`}>
                  Option {String.fromCharCode(65 + index)}
                </div>

                <div className="flex items-center gap-1.5">
                  {isApplied && (
                    <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
                      Applied
                    </span>
                  )}
                  {isRecommended && (
                    <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-fuchsia-200">
                      Recommended
                    </span>
                  )}
                </div>
              </div>
              <div className="leading-5">{choice}</div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function OutputPanel(props: {
  items: GeneratedItem[];
  loading: boolean;
  onGenerateMore: () => void;
}) {
  const [selected, setSelected] = useState<GeneratedItem | null>(null);

  if (props.loading) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">Generating…</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!props.items.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center">
          <Sparkles className="mx-auto h-12 w-12 text-gray-700" />
          <h2 className="text-base font-semibold text-gray-300 md:text-lg">
            Your creations will appear here
          </h2>
          <p className="text-xs text-gray-400">
            Describe something on the left and press Generate.
          </p>
        </div>
      </div>
    );
  }

  const latestItem = props.items[0];

  const handleDownloadLatest = () => {
    if (!latestItem?.url) return;
    const link = document.createElement("a");
    link.href = latestItem.url;
    link.download = latestItem.kind === "video" ? "sirens-forge-output.mp4" : "sirens-forge-output.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyPrompt = async () => {
    if (!latestItem?.prompt) return;
    try {
      await navigator.clipboard.writeText(latestItem.prompt);
    } catch {}
  };

  const handleTrainTwin = () => {
    window.location.href = "/lora/train";
  };

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-100">Latest Generation</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {props.items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="group relative aspect-square overflow-hidden rounded-xl border border-gray-800 bg-gray-950"
            >
              {item.kind === "image" ? (
                <img src={item.url} alt={item.prompt} className="h-full w-full object-cover" />
              ) : (
                <video src={item.url} className="h-full w-full object-cover" controls={false} muted loop />
              )}

              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => setSelected(item)}
                  className="bg-white/10 hover:bg-white/20"
                >
                  <Maximize2 className="h-4 w-4" />
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

        <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white md:text-base">Next Actions</h3>
              <p className="text-[11px] text-gray-400">Keep the momentum going from your latest generation.</p>
            </div>
            <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-200">
              Latest Output
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={handleDownloadLatest}
              className="justify-start gap-2 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-xs font-semibold text-white hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
            >
              <DownloadIcon />
              Download
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopyPrompt}
              className="justify-start gap-2 border-gray-700 bg-gray-900 text-xs text-gray-100 hover:bg-gray-800"
            >
              <Copy className="h-4 w-4" />
              Copy Prompt
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={props.onGenerateMore}
              className="justify-start gap-2 border-gray-700 bg-gray-900 text-xs text-gray-100 hover:bg-gray-800"
            >
              <Sparkles className="h-4 w-4" />
              Generate More Like This
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleTrainTwin}
              className="justify-start gap-2 border-gray-700 bg-gray-900 text-xs text-gray-100 hover:bg-gray-800"
            >
              <UserPlus className="h-4 w-4" />
              Train AI Twin
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/90 p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-4xl overflow-hidden rounded-xl border border-gray-800 bg-gray-950"
            >
              {selected.kind === "image" ? (
                <img src={selected.url} alt={selected.prompt} className="h-auto w-full" />
              ) : (
                <video src={selected.url} className="h-auto w-full" controls autoPlay muted loop />
              )}
              <div className="space-y-2 p-4 text-xs">
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
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
    <div className="h-full space-y-3 overflow-y-auto border-l border-gray-900 bg-gray-950/70 p-3 md:p-4">
      <h3 className="text-sm font-bold text-gray-100 md:text-base">Session History</h3>

      <div className="space-y-2 text-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Filter by prompt…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 border-gray-700 bg-gray-950 pl-9 text-xs text-gray-100 placeholder:text-gray-500"
          />
        </div>

        <div className="flex gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as "all" | "images" | "videos")}>
            <SelectTrigger className="h-8 border-gray-800 bg-gray-950 text-xs text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-gray-800 bg-gray-950 text-gray-100">
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="images">Images</SelectItem>
              <SelectItem value="videos">Videos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as "newest" | "oldest")}>
            <SelectTrigger className="h-8 border-gray-800 bg-gray-950 text-xs text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-gray-800 bg-gray-950 text-gray-100">
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
            className="flex cursor-pointer gap-2 rounded-lg border border-gray-800 bg-gray-900/80 p-2 hover:border-gray-700"
            onClick={() => props.onSelect(item)}
          >
            {item.kind === "image" ? (
              <img src={item.url} alt={item.prompt} className="h-12 w-12 rounded object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-800">
                <VideoIcon className="h-5 w-5 text-purple-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[11px] font-medium text-gray-100">{item.prompt}</p>
              <p className="mt-1 text-[10px] text-gray-400">
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
              className="h-7 w-7 shrink-0 text-gray-100 hover:text-white"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        ))}
      </div>

      {!filtered.length && (
        <div className="py-8 text-center text-[11px] text-gray-400">
          No history this session yet.
        </div>
      )}
    </div>
  );
}

export default function GeneratePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hydratedFromHandoffRef = useRef(false);

  const [mode, setMode] = useState<GenerationMode>("text_to_image");
  const [outputType, setOutputType] = useState<"IMAGE" | "STORY">("IMAGE");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
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

  const [showArrivalBanner, setShowArrivalBanner] = useState(false);
  const [highlightPrompt, setHighlightPrompt] = useState(false);
  const [refiningVariant, setRefiningVariant] = useState<RefineVariant | null>(null);
  const [refineChoices, setRefineChoices] = useState<string[] | null>(null);
  const [appliedRefineIndex, setAppliedRefineIndex] = useState<number | null>(null);
  const [refineFeedback, setRefineFeedback] = useState<string | null>(null);

  const incomingQueryPayload = useMemo<HandoffPayload | null>(() => {
    const promptParam = searchParams.get("prompt");
    const negativeParam = searchParams.get("negative_prompt");
    const outputTypeParam = searchParams.get("output_type");
    const generationTargetParam = searchParams.get("generation_target");
    const sourceParam = searchParams.get("source");

    if (
      !promptParam &&
      !negativeParam &&
      !outputTypeParam &&
      !generationTargetParam &&
      !sourceParam
    ) {
      return null;
    }

    return {
      prompt: promptParam || undefined,
      negative_prompt: negativeParam || undefined,
      output_type: outputTypeParam || undefined,
      generation_target: generationTargetParam || undefined,
      source: sourceParam || undefined,
    };
  }, [searchParams]);

  const selectedIdentityLabel = useMemo(() => {
    const selectedId = loraSelection.selected[0];
    if (!selectedId) return "Not selected";

    const match = identityOptions.find((item) => item.id === selectedId);
    if (!match) return "Not selected";

    return match.name && match.name.trim().length > 0 ? match.name : match.id;
  }, [identityOptions, loraSelection.selected]);

  const recommendedRefineIndex = useMemo(() => {
    if (!refineChoices || refineChoices.length === 0) return null;

    /**
     * Backend contract for refine variants is locked:
     * - variants[0] => Option A (clean / stable)
     * - variants[1] => Option B (best / recommended)
     * - variants[2] => Option C (stylized / bold)
     *
     * Keep the UI aligned to that production contract so Option B is always
     * labeled Recommended when all three variants are present.
     */
    if (refineChoices.length >= 3) return 1;

    let bestIndex = 0;
    let bestScore = -Infinity;

    refineChoices.forEach((choice, index) => {
      const score = getPromptStrengthScore(choice);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }, [refineChoices]);

  useEffect(() => {
    if (!refineFeedback) return;

    const timer = window.setTimeout(() => {
      setRefineFeedback(null);
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [refineFeedback]);

  const canGenerate =
    !isGenerating &&
    (mode === "image_to_video" ? Boolean(imageFile) : Boolean(prompt?.trim())) &&
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

    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (hydratedFromHandoffRef.current) return;

    let payload: HandoffPayload | null = null;

    if (incomingQueryPayload) {
      payload = incomingQueryPayload;
    } else {
      try {
        const raw = window.sessionStorage.getItem(SIREN_MIND_HANDOFF_STORAGE_KEY);
        if (raw) {
          payload = JSON.parse(raw) as HandoffPayload;
        }
      } catch (err) {
        console.error("Failed to restore Siren’s Mind handoff:", err);
      }
    }

    if (!payload) return;

    const incomingPrompt =
      typeof payload.prompt === "string" ? payload.prompt : "";
    const incomingNegative =
      typeof payload.negative_prompt === "string"
        ? payload.negative_prompt
        : "";
    const incomingOutputType =
      typeof payload.output_type === "string"
        ? payload.output_type.trim().toUpperCase()
        : "";
    const incomingMode = parseGenerationMode(payload.generation_target);

    if (incomingPrompt) setPrompt(incomingPrompt);
    if (incomingNegative) setNegativePrompt(incomingNegative);
    if (incomingOutputType === "STORY") {
      setOutputType("STORY");
    } else {
      setOutputType("IMAGE");
    }
    setMode(incomingMode);

    setShowArrivalBanner(true);
    setHighlightPrompt(true);
    hydratedFromHandoffRef.current = true;

    try {
      window.sessionStorage.removeItem(SIREN_MIND_HANDOFF_STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear Siren’s Mind handoff:", err);
    }

    if (incomingQueryPayload) {
      router.replace("/generate", { scroll: false });
    }

    const cinematicArrivalTimer = window.setTimeout(() => {
      const textarea = promptTextareaRef.current;
      if (!textarea) return;

      textarea.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      window.setTimeout(() => {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      }, 360);
    }, 1100);

    const highlightTimer = window.setTimeout(() => {
      setHighlightPrompt(false);
    }, 2600);

    return () => {
      window.clearTimeout(cinematicArrivalTimer);
      window.clearTimeout(highlightTimer);
    };
  }, [incomingQueryPayload, router]);

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


  const handleAiRefine = async (variant: RefineVariant) => {
    const basePrompt = prompt.trim();
    if (!basePrompt || refiningVariant) return;

    const refineInstruction =
      variant === "cinematic"
        ? "Refine this prompt to feel more cinematic, visually dramatic, and premium while preserving the core subject and intent."
        : variant === "explicit"
        ? "Refine this prompt to feel more erotic, explicit, and intense while preserving the core subject and intent."
        : "Refine this prompt to feel more photorealistic, natural, and believable while preserving the core subject and intent.";

    setErrorMessage(null);
    setRefiningVariant(variant);
    setRefineChoices(null);
    setAppliedRefineIndex(null);

    try {
      const res = await fetch("/api/nsfw-gpt/headless", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ULTRA",
          description: `${refineInstruction}

Prompt:
${basePrompt}`,
          generation_target: mode,
          task: "refine_prompt_variants",
          refine_type: variant,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          typeof data?.reason === "string"
            ? data.reason
            : typeof data?.message === "string"
            ? data.message
            : typeof data?.error === "string"
            ? data.error
            : "Auto-refine failed.";
        throw new Error(message);
      }

      const variants = Array.isArray(data?.variants)
        ? data.variants
            .map((item: unknown) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

      if (variants.length > 0) {
        const recommendedIndex = variants.length >= 3 ? 1 : 0;
        const recommendedChoice = variants[recommendedIndex] || variants[0];

        setRefineChoices(variants);
        setAppliedRefineIndex(recommendedIndex);

        if (recommendedChoice) {
          setPrompt(recommendedChoice);
          setRefineFeedback("✓ Best prompt applied");

          requestAnimationFrame(() => {
            if (promptTextareaRef.current) {
              promptTextareaRef.current.focus({ preventScroll: true });
              promptTextareaRef.current.setSelectionRange(
                recommendedChoice.length,
                recommendedChoice.length
              );
            }
          });
        }

        return;
      }

      if (typeof data?.prompt === "string" && data.prompt.trim()) {
        setPrompt(data.prompt.trim());
        setAppliedRefineIndex(null);
        setRefineChoices(null);
        return;
      }

      throw new Error("Auto-refine returned no usable prompt options.");
    } catch (err: any) {
      console.error("Auto-refine error:", err);
      setErrorMessage(err?.message || "Auto-refine failed.");
      setRefineChoices(null);
      setAppliedRefineIndex(null);
    } finally {
      setRefiningVariant(null);
    }
  };

  const handleApplyRefineChoice = (value: string, index: number) => {
    setPrompt(value);
    setAppliedRefineIndex(index);
    setRefineFeedback(index === recommendedRefineIndex ? "✓ Best prompt applied" : `✓ Option ${String.fromCharCode(65 + index)} applied`);

    if (promptTextareaRef.current) {
      promptTextareaRef.current.focus({ preventScroll: true });
      promptTextareaRef.current.setSelectionRange(value.length, value.length);
    }
  };

  const handleGenerate = async (overridePrompt?: string) => {
    const bodyModeMap: Record<string, string> = {
      feminine: "body_feminine",
      masculine: "body_masculine",
    };

    const selectedLoraId = loraSelection.selected[0] ?? null;
    const promptToUse = typeof overridePrompt === "string" ? overridePrompt : prompt;

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
        prompt: promptToUse,
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
            prompt: promptToUse,
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
            prompt: promptToUse || "(Image-driven video)",
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

  const handleGenerateRecommended = async () => {
    if (!refineChoices || refineChoices.length === 0 || recommendedRefineIndex === null) {
      return;
    }

    const recommendedChoice = refineChoices[recommendedRefineIndex];
    if (!recommendedChoice) return;

    handleApplyRefineChoice(recommendedChoice, recommendedRefineIndex);

    window.setTimeout(() => {
      void handleGenerate(recommendedChoice);
    }, 0);
  };

  const handleHistorySelect = (item: GeneratedItem) => {
    setPrompt(item.prompt);
  };

  const handleHistoryRerun = (item: GeneratedItem) => {
    setPrompt(item.prompt);
    handleGenerate();
  };

  return (
    <div className="flex min-h-screen flex-col bg-black text-gray-100">
      <GeneratorHeader activeMode={mode} />

      <main className="flex flex-1 flex-col md:flex-row">
        <div className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 py-4 md:px-6 md:py-6">
          <AnimatePresence>
            <HandoffArrivalBanner
              visible={showArrivalBanner}
              mode={mode}
              onDismiss={() => setShowArrivalBanner(false)}
            />
          </AnimatePresence>

          <HandoffConfidencePanel
            visible={showArrivalBanner}
            mode={mode}
            selectedIdentityLabel={selectedIdentityLabel}
            prompt={prompt}
            onPromptChange={setPrompt}
          />

          <ModeTabs activeMode={mode} onChange={setMode} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="space-y-4 xl:col-span-1">
              {mode === "image_to_video" && (
                <ImageToVideoUploadSection
                  imageFile={imageFile}
                  previewUrl={imagePreviewUrl}
                  onFileChange={setImageFile}
                />
              )}

              <PromptSection
                mode={mode}
                prompt={prompt}
                negativePrompt={negativePrompt}
                onPromptChange={(value) => {
                  setPrompt(value);
                  setRefineChoices(null);
                }}
                onNegativePromptChange={setNegativePrompt}
                onRefine={handleAiRefine}
                refiningVariant={refiningVariant}
                textareaRef={promptTextareaRef}
                highlight={highlightPrompt}
              />

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <LoraIdentitySection
                  value={loraSelection}
                  onChange={(next) => setLoraSelection(next)}
                  options={identitySelectOptions}
                />

                <ModelStyleSection
                  baseModel={baseModel}
                  stylePreset={stylePreset}
                  onBaseModelChange={setBaseModel}
                  onStylePresetChange={setStylePreset}
                />
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 text-[11px] text-gray-300">
                <div className="font-semibold text-gray-100">Ultra add-on</div>
                <div className="mt-1">
                  Type{" "}
                  <span className="font-mono text-gray-100">(d1ldo)</span> anywhere in your prompt to enable the dildo-play add-on.
                  Helpful words: small dildo, medium dildo, big dildo, on back, on side, doggystyle, ass, close-up,
                  masturbation, vaginal.
                </div>
              </div>

              <SirensMindCTA onOpen={() => router.push("/sirens-mind")} />

            </div>

            <div className="space-y-4 xl:col-span-1">
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

              <AnimatePresence>
                {refineFeedback && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.12)]"
                  >
                    {refineFeedback}
                  </motion.div>
                )}
              </AnimatePresence>

              <RefineChoicesPanel
                choices={refineChoices}
                onApply={handleApplyRefineChoice}
                onGenerateRecommended={handleGenerateRecommended}
                recommendedIndex={recommendedRefineIndex}
                appliedIndex={appliedRefineIndex}
                generatingRecommended={isGenerating}
              />

              {errorMessage && <p className="text-[11px] text-red-400">{errorMessage}</p>}
            </div>

            <div className="space-y-4 xl:col-span-1">
              <Card className="h-full border-gray-800 bg-gray-900/80">
                <CardContent className="h-full p-4">
                  <OutputPanel items={items} loading={isGenerating} onGenerateMore={handleGenerate} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <div className="w-full border-t border-gray-900 md:w-80 md:border-l md:border-t-0 lg:w-96">
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
