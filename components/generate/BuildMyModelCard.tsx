"use client";

import React, { useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Crown,
  Flame,
  Gem,
  Heart,
  Save,
  Sparkles,
  Stars,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export type BuildModelBaseModel = "feminine" | "masculine";

export type BuildModelVibe =
  | "baddie"
  | "goddess"
  | "soft_girlfriend"
  | "goth_alt"
  | "dominant"
  | "luxury"
  | "gamer";

export type BuildModelHair =
  | "blonde"
  | "brunette"
  | "black"
  | "red"
  | "fantasy";

export type BuildModelStyle =
  | "lingerie"
  | "streetwear"
  | "luxury"
  | "gym"
  | "nude_nsfw";

export type BuildModelEnergy =
  | "obsessed"
  | "flirty"
  | "cold"
  | "possessive"
  | "dominant";

export type BuildModelIntensity = "soft" | "bold" | "extreme";

export interface BuildMyModelSelection {
  vibes: BuildModelVibe[];
  baseModel: BuildModelBaseModel;
  hair: BuildModelHair;
  style: BuildModelStyle;
  energy: BuildModelEnergy;
  intensity: BuildModelIntensity;
}

export interface BuildMyModelCompiledResult {
  prompt: string;
  negativePrompt: string;
  selection: BuildMyModelSelection;
  selectedPreviewImage?: string | null;
  identityName?: string;
}

interface BuildMyModelCardProps {
  className?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  onApplyPrompt: (result: BuildMyModelCompiledResult) => void;
  onBaseModelChange?: (baseModel: BuildModelBaseModel) => void;
  onGenerateNow?: (result: BuildMyModelCompiledResult) => void;
}

const DEFAULT_NEGATIVE_PROMPT =
  "cartoon, 3d, render, low res, low resolution, blurry, poor quality, jpeg artifacts, cgi, bad anatomy, deformed, extra fingers, extra limbs, inconsistent face, duplicate person, distorted hands";

const VIBE_OPTIONS: {
  id: BuildModelVibe;
  label: string;
  description: string;
  icon: React.ElementType;
  prompt: string;
}[] = [
  {
    id: "baddie",
    label: "Baddie Energy",
    description: "confident, glossy, social-first",
    icon: Flame,
    prompt:
      "confident baddie influencer energy, glossy social media aesthetic, bold eye contact, high-value creator presence",
  },
  {
    id: "goddess",
    label: "Goddess Worship",
    description: "elevated, adored, premium",
    icon: Crown,
    prompt:
      "goddess-like presence, adored and magnetic, elevated sensuality, worshipful camera framing, premium fantasy energy",
  },
  {
    id: "soft_girlfriend",
    label: "Soft Girlfriend",
    description: "warm, intimate, addictive",
    icon: Heart,
    prompt:
      "soft girlfriend fantasy, warm intimate expression, approachable sensuality, emotionally addictive creator energy",
  },
  {
    id: "goth_alt",
    label: "Goth / Alt",
    description: "dark, moody, sharp",
    icon: Stars,
    prompt:
      "goth alternative aesthetic, dark moody atmosphere, sharp styling, black accents, seductive shadowed mood",
  },
  {
    id: "dominant",
    label: "Dominant",
    description: "commanding, intense, controlled",
    icon: Zap,
    prompt:
      "dominant commanding presence, controlled posture, intense gaze, powerful seductive authority",
  },
  {
    id: "luxury",
    label: "Luxury Influencer",
    description: "expensive, polished, aspirational",
    icon: Gem,
    prompt:
      "luxury influencer aesthetic, expensive polished styling, aspirational lifestyle mood, high-end editorial finish",
  },
  {
    id: "gamer",
    label: "Gamer",
    description: "playful, neon, fan-service",
    icon: WandSparkles,
    prompt:
      "playful gamer creator aesthetic, neon accents, streamer-inspired mood, fun fan-service energy",
  },
];

const VIBE_LABELS: Record<BuildModelVibe, string> = {
  baddie: "Baddie",
  goddess: "Goddess",
  soft_girlfriend: "Soft Girlfriend",
  goth_alt: "Goth Alt",
  dominant: "Dominant",
  luxury: "Luxury",
  gamer: "Gamer",
};

const HAIR_PROMPTS: Record<BuildModelHair, string> = {
  blonde: "blonde hair, polished camera-ready styling",
  brunette: "brunette hair, rich natural tones, polished styling",
  black: "black hair, high contrast styling, sleek detail",
  red: "vibrant red hair, striking color contrast, memorable visual identity",
  fantasy: "fantasy colored hair, bold creator-brand color, striking visual hook",
};

const BODY_PROMPTS: Record<BuildModelBaseModel, string> = {
  feminine:
    "adult feminine model, photorealistic face, consistent facial identity, natural curves, feminine body proportions",
  masculine:
    "adult masculine model, photorealistic face, consistent facial identity, strong masculine body proportions",
};

const STYLE_PROMPTS: Record<BuildModelStyle, string> = {
  lingerie:
    "lingerie styling, lace texture, intimate bedroom or studio setting, sensual premium boudoir mood",
  streetwear:
    "streetwear styling, fitted modern outfit, urban creator aesthetic, confident lifestyle photography",
  luxury:
    "luxury styling, elegant outfit, premium room setting, high-end editorial photography",
  gym:
    "gym styling, athletic outfit, fitness creator aesthetic, clean studio lighting, strong body-focused composition",
  nude_nsfw:
    "nude NSFW leaning styling, tasteful explicit creator aesthetic, intimate setting, strong adult sensual focus",
};

const ENERGY_PROMPTS: Record<BuildModelEnergy, string> = {
  obsessed:
    "viewer-focused expression, emotionally attached energy, intimate gaze, makes the viewer feel personally wanted",
  flirty:
    "flirty expression, teasing smile, playful seductive body language, fun intimate eye contact",
  cold:
    "cold untouchable energy, distant luxury expression, controlled gaze, premium unavailable fantasy",
  possessive:
    "possessive romantic energy, intense eye contact, protective seductive mood, emotionally charged intimacy",
  dominant:
    "dominant behavioral energy, commanding gaze, controlled pose, confident sexual authority",
};

const INTENSITY_PROMPTS: Record<BuildModelIntensity, string> = {
  soft:
    "soft sensuality, suggestive but refined, warm lighting, elegant erotic tension",
  bold:
    "bold sensuality, stronger erotic framing, confident provocative pose, intimate camera distance",
  extreme:
    "extreme adult intensity, explicit NSFW energy, very provocative framing, high-impact erotic creator content",
};

const baseSelection: BuildMyModelSelection = {
  vibes: ["baddie"],
  baseModel: "feminine",
  hair: "brunette",
  style: "lingerie",
  energy: "flirty",
  intensity: "bold",
};

function joinPrompt(parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+/g, " ");
}

function getDefaultIdentityName(selection: BuildMyModelSelection) {
  const vibe = selection.vibes[0] ? VIBE_LABELS[selection.vibes[0]] : "Creator";
  const body = selection.baseModel === "feminine" ? "Muse" : "Model";
  return `${vibe} ${body}`;
}

export function compileBuildMyModelPrompt(
  selection: BuildMyModelSelection,
  selectedPreviewImage?: string | null,
  identityName?: string
): BuildMyModelCompiledResult {
  const selectedVibes =
    selection.vibes.length > 0 ? selection.vibes : baseSelection.vibes;

  const vibePrompt = selectedVibes
    .map((id) => VIBE_OPTIONS.find((item) => item.id === id)?.prompt)
    .filter(Boolean)
    .join(", ");

  const prompt = joinPrompt([
    "ultra photorealistic adult AI creator model",
    BODY_PROMPTS[selection.baseModel],
    HAIR_PROMPTS[selection.hair],
    STYLE_PROMPTS[selection.style],
    vibePrompt,
    ENERGY_PROMPTS[selection.energy],
    INTENSITY_PROMPTS[selection.intensity],
    "same person, consistent face, repeatable identity, high detail skin texture, natural anatomy, realistic hands",
    "premium creator photography, cinematic lighting, shallow depth of field, sharp focus, professional composition",
    "designed as a reusable identity seed for future SirensForge generations",
  ]);

  return {
    prompt,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    selection,
    selectedPreviewImage: selectedPreviewImage || null,
    identityName: identityName?.trim() || getDefaultIdentityName(selection),
  };
}

function normalizePreviewImages(data: any): string[] {
  const possibleArrays = [
    data?.images,
    data?.outputs,
    data?.results,
    data?.generated,
    data?.data?.images,
    data?.data?.outputs,
  ];

  for (const value of possibleArrays) {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          return item?.url || item?.image_url || item?.output_url || item?.media_url || "";
        })
        .filter(Boolean);
    }
  }

  const single =
    data?.url ||
    data?.image_url ||
    data?.output_url ||
    data?.media_url ||
    data?.generation?.image_url;

  return single ? [single] : [];
}

function ChoiceButton(props: {
  active: boolean;
  label: string;
  description?: string;
  icon?: React.ElementType;
  onClick: () => void;
}) {
  const Icon = props.icon;

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`group rounded-2xl border px-3 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 ${
        props.active
          ? "border-fuchsia-400/60 bg-fuchsia-500/15 shadow-[0_0_24px_rgba(217,70,239,0.16)]"
          : "border-zinc-800 bg-black/25 hover:border-zinc-700 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        {Icon ? (
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
              props.active
                ? "bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-white"
                : "bg-zinc-900 text-zinc-400 group-hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="text-xs font-bold text-white">{props.label}</div>
          {props.description ? (
            <div className="mt-1 text-[10px] leading-4 text-zinc-400">
              {props.description}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function BuildMyModelCard(props: BuildMyModelCardProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [step, setStep] = useState(0);
  const [selection, setSelection] =
    useState<BuildMyModelSelection>(baseSelection);
  const [identityName, setIdentityName] = useState(getDefaultIdentityName(baseSelection));
  const [applied, setApplied] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [identitySaved, setIdentitySaved] = useState(false);
  const [identitySaveError, setIdentitySaveError] = useState<string | null>(null);

  const compiled = useMemo(
    () => compileBuildMyModelPrompt(selection, selectedPreviewImage, identityName),
    [identityName, selection, selectedPreviewImage]
  );

  const resetPreviewState = () => {
    setApplied(false);
    setIdentitySaved(false);
    setPreviewImages([]);
    setSelectedPreviewImage(null);
    setPreviewError(null);
    setIdentitySaveError(null);
  };

  const updateSelection = (updater: (prev: BuildMyModelSelection) => BuildMyModelSelection) => {
    setSelection((prev) => {
      const next = updater(prev);
      if (identityName === getDefaultIdentityName(prev)) {
        setIdentityName(getDefaultIdentityName(next));
      }
      return next;
    });
    resetPreviewState();
  };

  const toggleVibe = (id: BuildModelVibe) => {
    updateSelection((prev) => {
      const alreadySelected = prev.vibes.includes(id);

      if (alreadySelected) {
        const next = prev.vibes.filter((item) => item !== id);
        return { ...prev, vibes: next.length > 0 ? next : [id] };
      }

      const next = [...prev.vibes, id].slice(-2);
      return { ...prev, vibes: next };
    });
  };

  const setBaseModel = (baseModel: BuildModelBaseModel) => {
    updateSelection((prev) => ({ ...prev, baseModel }));
    props.onBaseModelChange?.(baseModel);
  };

  const applyPrompt = () => {
    props.onApplyPrompt(compiled);
    props.onBaseModelChange?.(selection.baseModel);
    setApplied(true);
  };

  const generateNow = () => {
    applyPrompt();
    props.onGenerateNow?.(compiled);
  };

  const saveIdentity = async () => {
    if (identitySaved) return;

    setIsSavingIdentity(true);
    setIdentitySaveError(null);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user?.id) {
        throw new Error("You must be logged in to save this identity.");
      }

      const basePayload = {
        user_id: userData.user.id,
        name: compiled.identityName || getDefaultIdentityName(selection),
        description: "Created from Build My Model on the Generate page.",
        preview_url: compiled.selectedPreviewImage || null,
        source: "build_my_model",
        base_model: selection.baseModel,
        prompt: compiled.prompt,
        negative_prompt: compiled.negativePrompt,
        selection,
        is_identity_seed: true,
        image_count: compiled.selectedPreviewImage ? 1 : 0,
      };

      const firstAttempt = await supabase
        .from("user_loras")
        .insert({
          ...basePayload,
          status: "draft",
        })
        .select("id")
        .single();

      if (firstAttempt.error) {
        const retryAttempt = await supabase
          .from("user_loras")
          .insert({
            ...basePayload,
            status: "pending",
          })
          .select("id")
          .single();

        if (retryAttempt.error) {
          throw retryAttempt.error;
        }
      }

      setIdentitySaved(true);
      setApplied(true);
    } catch (error) {
      console.error("Build My Model identity save failed", error);
      setIdentitySaveError(
        error instanceof Error
          ? error.message
          : "Identity save failed. You can still load the prompt and generate normally."
      );
    } finally {
      setIsSavingIdentity(false);
    }
  };

  const previewModel = async () => {
    setIsPreviewing(true);
    setPreviewError(null);
    setPreviewImages([]);
    setSelectedPreviewImage(null);
    setIdentitySaved(false);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "text_to_image",
          prompt: compiled.prompt,
          negative_prompt: compiled.negativePrompt,
          baseModel: selection.baseModel,
          stylePreset: "photorealistic",
          qualityPreset: "balanced",
          consistencyPreset: "high",
          batchSize: 4,
          preview: true,
          source: "build_my_model",
          buildMyModelSelection: selection,
          identityName: compiled.identityName,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || data?.message || "Preview generation failed.");
      }

      const images = normalizePreviewImages(data);

      if (images.length === 0) {
        throw new Error("Preview response did not include image URLs yet.");
      }

      setPreviewImages(images);
      setSelectedPreviewImage(images[0] || null);
    } catch (error) {
      console.error("Build My Model preview failed", error);
      setPreviewError(
        error instanceof Error
          ? error.message
          : "Preview generation failed. Load the prompt and generate normally."
      );
    } finally {
      setIsPreviewing(false);
    }
  };

  const steps = [
    {
      label: "Vibe",
      title: "Pick the model’s hook",
      description: "Choose up to 2. This controls the fantasy, visual tone, and first-click attraction.",
    },
    {
      label: "Look",
      title: "Shape the visual identity",
      description: "Keep this fast. Body type maps to the supported LoRA modes you actually have right now.",
    },
    {
      label: "Energy",
      title: "Choose how they pull the viewer in",
      description: "This controls attitude, intensity, and the emotional reason users keep generating.",
    },
  ];

  return (
    <Card
      className={`overflow-hidden border-fuchsia-500/20 bg-[linear-gradient(180deg,rgba(24,14,34,0.92),rgba(8,8,13,0.96))] shadow-[0_0_30px_rgba(192,38,211,0.10)] ${props.className || ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.03]"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-white shadow-[0_0_22px_rgba(192,38,211,0.22)]">
            <UserlessSparklesIcon />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm text-white md:text-base">
                Don’t have a model yet?
              </CardTitle>
              <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200">
                Build My Model
              </span>
            </div>
            <CardDescription className="mt-1 text-xs leading-5 text-zinc-400">
              Pick a vibe, look, and energy. Preview the model direction visually, then save it as an identity starter.
            </CardDescription>
          </div>
        </div>

        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
        )}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-white/10"
          >
            <CardHeader className="pb-2">
              <div className="grid grid-cols-3 gap-2">
                {steps.map((item, index) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setStep(index)}
                    className={`rounded-xl border px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                      step === index
                        ? "border-fuchsia-400/45 bg-fuchsia-500/15 text-white"
                        : "border-zinc-800 bg-black/20 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {index + 1}. {item.label}
                  </button>
                ))}
              </div>

              <div className="pt-3">
                <CardTitle className="text-base text-white">
                  {steps[step].title}
                </CardTitle>
                <CardDescription className="mt-1 text-xs leading-5 text-zinc-400">
                  {steps[step].description}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <AnimatePresence mode="wait">
                {step === 0 ? (
                  <motion.div
                    key="vibe-step"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.15 }}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    {VIBE_OPTIONS.map((item) => (
                      <ChoiceButton
                        key={item.id}
                        active={selection.vibes.includes(item.id)}
                        label={item.label}
                        description={item.description}
                        icon={item.icon}
                        onClick={() => toggleVibe(item.id)}
                      />
                    ))}
                  </motion.div>
                ) : null}

                {step === 1 ? (
                  <motion.div
                    key="look-step"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                        Body Type
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <ChoiceButton
                          active={selection.baseModel === "feminine"}
                          label="Feminine"
                          description="Uses current feminine body mode"
                          onClick={() => setBaseModel("feminine")}
                        />
                        <ChoiceButton
                          active={selection.baseModel === "masculine"}
                          label="Masculine"
                          description="Uses current masculine body mode"
                          onClick={() => setBaseModel("masculine")}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                        Hair
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {(["blonde", "brunette", "black", "red", "fantasy"] as BuildModelHair[]).map((hair) => (
                          <button
                            key={hair}
                            type="button"
                            onClick={() => updateSelection((prev) => ({ ...prev, hair }))}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                              selection.hair === hair
                                ? "border-cyan-400/50 bg-cyan-500/15 text-white"
                                : "border-zinc-800 bg-black/25 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {hair}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                        Style
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                        {([
                          ["lingerie", "Lingerie"],
                          ["streetwear", "Streetwear"],
                          ["luxury", "Luxury"],
                          ["gym", "Gym"],
                          ["nude_nsfw", "Nude / NSFW"],
                        ] as [BuildModelStyle, string][]).map(([style, label]) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => updateSelection((prev) => ({ ...prev, style }))}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                              selection.style === style
                                ? "border-cyan-400/50 bg-cyan-500/15 text-white"
                                : "border-zinc-800 bg-black/25 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : null}

                {step === 2 ? (
                  <motion.div
                    key="energy-step"
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                      {([
                        ["obsessed", "Obsessed"],
                        ["flirty", "Flirty"],
                        ["cold", "Cold"],
                        ["possessive", "Possessive"],
                        ["dominant", "Dominant"],
                      ] as [BuildModelEnergy, string][]).map(([energy, label]) => (
                        <button
                          key={energy}
                          type="button"
                          onClick={() => updateSelection((prev) => ({ ...prev, energy }))}
                          className={`rounded-xl border px-3 py-3 text-xs font-semibold transition ${
                            selection.energy === energy
                              ? "border-fuchsia-400/50 bg-fuchsia-500/15 text-white"
                              : "border-zinc-800 bg-black/25 text-zinc-400 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                          Intensity
                        </div>
                        <div className="text-[11px] font-semibold capitalize text-fuchsia-200">
                          {selection.intensity}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {(["soft", "bold", "extreme"] as BuildModelIntensity[]).map((intensity) => (
                          <button
                            key={intensity}
                            type="button"
                            onClick={() => updateSelection((prev) => ({ ...prev, intensity }))}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition ${
                              selection.intensity === intensity
                                ? "border-pink-400/50 bg-pink-500/15 text-white"
                                : "border-zinc-800 bg-black/25 text-zinc-400 hover:text-white"
                            }`}
                          >
                            {intensity}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {step === 2 ? (
                <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 px-3 py-3">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-purple-200">
                        Visual Preview
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-400">
                        Generate 4 preview images, pick the strongest direction, then save it as an identity starter.
                      </p>
                    </div>

                    <Button
                      type="button"
                      onClick={previewModel}
                      disabled={props.disabled || isPreviewing}
                      className="h-9 shrink-0 border border-purple-500/40 bg-black/40 px-4 text-xs font-bold text-purple-100 hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isPreviewing ? "Generating Preview..." : "Preview My Model"}
                    </Button>
                  </div>

                  {previewError ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                      {previewError}
                    </div>
                  ) : null}

                  {previewImages.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {previewImages.map((imageUrl, index) => {
                        const selected = selectedPreviewImage === imageUrl;

                        return (
                          <button
                            key={`${imageUrl}-${index}`}
                            type="button"
                            onClick={() => {
                              setSelectedPreviewImage(imageUrl);
                              setIdentitySaved(false);
                              setIdentitySaveError(null);
                            }}
                            className={`group relative overflow-hidden rounded-xl border transition hover:-translate-y-0.5 ${
                              selected
                                ? "border-purple-300 shadow-[0_0_24px_rgba(168,85,247,0.25)]"
                                : "border-zinc-800 hover:border-zinc-600"
                            }`}
                          >
                            <img
                              src={imageUrl}
                              alt={`Build My Model preview ${index + 1}`}
                              className="h-40 w-full bg-zinc-950 object-cover transition group-hover:scale-[1.02]"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2 text-left">
                              <span className="text-[10px] font-semibold text-white">
                                Preview {index + 1}
                              </span>
                            </div>
                            {selected ? (
                              <div className="absolute right-2 top-2 rounded-full bg-purple-500 p-1 text-white shadow-lg">
                                <CheckCircle2 className="h-4 w-4" />
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {step === 2 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">
                        Identity Starter
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-zinc-400">
                        Save this direction so the creator can return to it later.
                      </p>
                    </div>
                    {identitySaved ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={identityName}
                      onChange={(event) => {
                        setIdentityName(event.target.value);
                        setIdentitySaved(false);
                        setIdentitySaveError(null);
                      }}
                      placeholder="Identity name"
                      className="h-10 flex-1 rounded-xl border border-zinc-800 bg-black/35 px-3 text-xs font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/50"
                    />
                    <Button
                      type="button"
                      onClick={saveIdentity}
                      disabled={props.disabled || isSavingIdentity || identitySaved}
                      className="h-10 shrink-0 bg-emerald-500 px-4 text-xs font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingIdentity ? (
                        "Saving..."
                      ) : identitySaved ? (
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" /> Identity Saved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Save className="h-4 w-4" /> Save Identity
                        </span>
                      )}
                    </Button>
                  </div>


                  {identitySaveError ? (
                    <div className="mt-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-100">
                      {identitySaveError}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-2xl border border-zinc-800 bg-black/30 px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                    Compiled Prompt Preview
                  </div>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                    Prompt ready
                  </span>
                </div>
                <p className="line-clamp-3 text-[11px] leading-5 text-zinc-300">
                  {compiled.prompt}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep((value) => Math.max(0, value - 1))}
                    className="h-10 border-zinc-800 bg-black/30 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    Back
                  </Button>
                ) : null}

                {step < 2 ? (
                  <Button
                    type="button"
                    onClick={() => setStep((value) => Math.min(2, value + 1))}
                    className="h-10 flex-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-xs font-bold text-white hover:brightness-110"
                  >
                    Next
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      onClick={applyPrompt}
                      disabled={props.disabled}
                      className="h-10 flex-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-xs font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {applied ? (
                        <span className="inline-flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Prompt Loaded
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Sparkles className="h-4 w-4" />
                          Use This Model Prompt
                        </span>
                      )}
                    </Button>

                    {props.onGenerateNow ? (
                      <Button
                        type="button"
                        onClick={generateNow}
                        disabled={props.disabled}
                        className="h-10 flex-1 bg-white text-xs font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Generate My Model
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </CardContent>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

function UserlessSparklesIcon() {
  return <Sparkles className="h-5 w-5" />;
}
