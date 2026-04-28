"use client";

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  Maximize2,
  Download,
  Play,
  Filter,
  Crown,
  Star,
  Shield,
  Grid3X3,
  Layers3,
  Wand2,
  ExternalLink,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

export type LibraryItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  prompt: string;
  createdAt: string;
  status: string;
  mode: string | null;
  bodyMode: string | null;
  identityLora: string | null;
};

type FilterMode = "all" | "images" | "videos";
type SortMode = "newest" | "oldest";
type ViewMode = "all" | "identity";

type IdentityGroup = {
  key: string;
  identityId: string | null;
  title: string;
  subtitle: string;
  items: LibraryItem[];
  imageCount: number;
  videoCount: number;
  latestCreatedAt: string | null;
  heroItem: LibraryItem | null;
};

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatRelative(value: string) {
  try {
    const date = new Date(value).getTime();
    const now = Date.now();
    const diffMs = now - date;

    const minutes = Math.floor(diffMs / 1000 / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return "Recently";
  }
}

function downloadFile(url: string, filename?: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "sirensforge-asset";
  link.target = "_blank";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function shortIdentityLabel(identityId: string | null) {
  if (!identityId) return "No Identity";
  return `Identity ${identityId.slice(0, 8)}`;
}

function getGroupSortTime(group: IdentityGroup) {
  if (!group.latestCreatedAt) return 0;
  const time = new Date(group.latestCreatedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function LibraryHeader() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/70 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Your Content Vault
          </h1>
          <p className="text-xs md:text-sm text-gray-300 mt-1">
            Your creations, organized around the identities you are building.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-black text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.35)]">
            <Shield className="w-3 h-3" />
            PRIVATE VAULT
          </div>

          <div className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            ✅ Active Subscription
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-purple-500/60">
              <AvatarFallback className="bg-gray-900 text-purple-300">
                S
              </AvatarFallback>
            </Avatar>
            <span className="hidden md:block text-sm font-medium text-gray-100">
              Sirens Member
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function LibraryStats({ items }: { items: LibraryItem[] }) {
  const total = items.length;
  const images = items.filter((i) => i.kind === "image").length;
  const videos = items.filter((i) => i.kind === "video").length;
  const withIdentity = items.filter((i) => Boolean(i.identityLora)).length;

  const cards = [
    {
      label: "Total Assets",
      value: total,
      icon: Sparkles,
      glow: "from-purple-500/25 via-pink-500/10 to-cyan-500/25",
      border: "border-purple-900/40",
      text: "text-purple-200",
    },
    {
      label: "Images",
      value: images,
      icon: ImageIcon,
      glow: "from-pink-500/20 via-purple-500/10 to-transparent",
      border: "border-pink-900/40",
      text: "text-pink-200",
    },
    {
      label: "Videos",
      value: videos,
      icon: VideoIcon,
      glow: "from-cyan-500/20 via-blue-500/10 to-transparent",
      border: "border-cyan-900/40",
      text: "text-cyan-200",
    },
    {
      label: "Identity-Based",
      value: withIdentity,
      icon: Crown,
      glow: "from-yellow-500/20 via-orange-500/10 to-transparent",
      border: "border-yellow-900/40",
      text: "text-yellow-200",
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={`relative rounded-2xl overflow-hidden border ${card.border} bg-gray-900/80`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${card.glow}`} />
            <div className="relative px-4 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                    {card.label}
                  </p>
                  <p className={`mt-1 text-2xl font-bold ${card.text}`}>
                    {card.value}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-2xl bg-black/30 border border-white/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-white/85" />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VaultIntentBanner() {
  return (
    <Card className="overflow-hidden border-purple-900/40 bg-gray-900/80">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/15 via-pink-500/10 to-cyan-500/15" />
        <CardContent className="relative p-5 md:p-6">
          <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-center">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-purple-200">
                <Lock className="h-3.5 w-3.5" />
                Identity Engine
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-white">
                Your Vault is not just storage — it is where your AI identities grow.
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-gray-300">
                Use All Assets when you want the full gallery. Switch to By Identity when you want to build around a specific AI Twin, review their strongest outputs, and generate more with the same look.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-lg font-bold text-purple-200">1</p>
                <p className="text-gray-400">Create</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-lg font-bold text-pink-200">2</p>
                <p className="text-gray-400">Save</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-lg font-bold text-cyan-200">3</p>
                <p className="text-gray-400">Evolve</p>
              </div>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardContent className="py-16">
        <div className="text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-3xl bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-800/40 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-purple-300" />
          </div>

          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
              Your vault is empty
            </h2>
            <p className="text-sm text-gray-400 mt-2 max-w-xl mx-auto">
              Start generating content and it will appear here — ready to reuse, download, and build from anytime.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap justify-center gap-2">
            <Link href="/generate">
              <Button className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.35)]">
                <Sparkles className="w-4 h-4 mr-2" />
                Open Generator
              </Button>
            </Link>
            <Link href="/identities">
              <Button
                type="button"
                variant="outline"
                className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
              >
                <Crown className="w-4 h-4 mr-2" />
                View Identities
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VaultToolbar(props: {
  query: string;
  filter: FilterMode;
  sort: SortMode;
  view: ViewMode;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: FilterMode) => void;
  onSortChange: (value: SortMode) => void;
  onViewChange: (value: ViewMode) => void;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Filter className="w-4 h-4 text-purple-300" />
              Vault Controls
            </CardTitle>
            <CardDescription className="text-xs text-gray-300 mt-1">
              Search, sort, and choose whether to browse everything or build by identity.
            </CardDescription>
          </div>

          <div className="inline-flex rounded-2xl border border-gray-800 bg-gray-950 p-1">
            <Button
              type="button"
              size="sm"
              onClick={() => props.onViewChange("all")}
              className={
                props.view === "all"
                  ? "bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                  : "bg-transparent text-gray-300 hover:bg-gray-900 hover:text-white"
              }
            >
              <Grid3X3 className="w-4 h-4 mr-2" />
              All Assets
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => props.onViewChange("identity")}
              className={
                props.view === "identity"
                  ? "bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500"
                  : "bg-transparent text-gray-300 hover:bg-gray-900 hover:text-white"
              }
            >
              <Layers3 className="w-4 h-4 mr-2" />
              By Identity
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by prompt, mode, body type, or identity..."
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            className="pl-10 bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 h-10"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select value={props.filter} onValueChange={(v) => props.onFilterChange(v as FilterMode)}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-10 text-sm text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
              <SelectItem value="all">All Assets</SelectItem>
              <SelectItem value="images">Images Only</SelectItem>
              <SelectItem value="videos">Videos Only</SelectItem>
            </SelectContent>
          </Select>

          <Select value={props.sort} onValueChange={(v) => props.onSortChange(v as SortMode)}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-10 text-sm text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetCard(props: {
  item: LibraryItem;
  index: number;
  onOpen: (item: LibraryItem) => void;
}) {
  const { item, index, onOpen } = props;

  return (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      className="group rounded-2xl overflow-hidden border border-gray-800 bg-gray-900/80 hover:border-purple-700/50 hover:shadow-[0_0_28px_rgba(168,85,247,0.12)] transition-all"
    >
      <div className="relative aspect-[4/5] bg-gray-950 overflow-hidden">
        {item.kind === "image" ? (
          <img
            src={item.url}
            alt={item.prompt}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <>
            <video
              src={item.url}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              muted
              loop
              playsInline
            />
            <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[10px] font-semibold text-cyan-200 flex items-center gap-1">
              <Play className="w-3 h-3" />
              VIDEO
            </div>
          </>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/10 opacity-100" />

        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => onOpen(item)}
            className="h-9 w-9 bg-black/55 border border-white/10 hover:bg-black/75 text-white"
          >
            <Maximize2 className="w-4 h-4" />
          </Button>

          <Button
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => downloadFile(item.url, `sirensforge-${item.kind}-${item.id}`)}
            className="h-9 w-9 bg-black/55 border border-white/10 hover:bg-black/75 text-white"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${
                item.kind === "image"
                  ? "bg-pink-500/15 text-pink-200 border-pink-500/30"
                  : "bg-cyan-500/15 text-cyan-200 border-cyan-500/30"
              }`}
            >
              {item.kind === "image" ? "IMAGE" : "VIDEO"}
            </span>

            {item.identityLora && (
              <span className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-yellow-500/10 text-yellow-200 border-yellow-500/25 flex items-center gap-1">
                <Star className="w-3 h-3" />
                IDENTITY
              </span>
            )}
          </div>

          <p className="text-xs font-medium text-gray-100 line-clamp-2">
            {item.prompt || "(No prompt saved)"}
          </p>

          <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
            <span>{formatRelative(item.createdAt)}</span>
            <span>{item.mode || "generation"}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function VaultGrid(props: {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {props.items.map((item, index) => (
        <AssetCard key={item.id} item={item} index={index} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

function IdentityGroupCard(props: {
  group: IdentityGroup;
  onOpen: (item: LibraryItem) => void;
}) {
  const { group, onOpen } = props;
  const previewItems = group.items.slice(0, 4);
  const hero = group.heroItem;

  return (
    <Card className="overflow-hidden border-gray-800 bg-gray-900/80 hover:border-purple-800/60 transition-all">
      <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="relative min-h-[320px] bg-gray-950 overflow-hidden">
          {hero ? (
            hero.kind === "image" ? (
              <img src={hero.url} alt={hero.prompt} className="h-full w-full object-cover" />
            ) : (
              <video src={hero.url} className="h-full w-full object-cover" muted loop playsInline />
            )
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-cyan-500/10 flex items-center justify-center">
              <Crown className="h-16 w-16 text-purple-300" />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/10" />

          <div className="absolute left-4 right-4 bottom-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/25 bg-yellow-500/10 px-2.5 py-1 text-[10px] font-bold text-yellow-200">
                <Crown className="h-3 w-3" />
                {group.identityId ? "AI TWIN" : "UNLINKED"}
              </span>
              <span className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] font-semibold text-gray-200">
                {group.items.length} asset{group.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-white">{group.title}</h3>
              <p className="mt-1 text-sm text-gray-300">{group.subtitle}</p>
            </div>
          </div>
        </div>

        <CardContent className="p-4 md:p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-3 text-center">
              <ImageIcon className="mx-auto mb-1 h-4 w-4 text-pink-300" />
              <p className="text-lg font-bold text-pink-200">{group.imageCount}</p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Images</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-3 text-center">
              <VideoIcon className="mx-auto mb-1 h-4 w-4 text-cyan-300" />
              <p className="text-lg font-bold text-cyan-200">{group.videoCount}</p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Videos</p>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-950 p-3 text-center">
              <Sparkles className="mx-auto mb-1 h-4 w-4 text-purple-300" />
              <p className="text-lg font-bold text-purple-200">{group.items.length}</p>
              <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Total</p>
            </div>
          </div>

          <div className="rounded-2xl border border-purple-900/40 bg-purple-500/10 p-4">
            <p className="text-sm font-semibold text-purple-100">
              Identity Strength: Growing
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-300">
              More saved generations give this identity a stronger creative history. Use this section to find what works and generate more around the same look.
            </p>
          </div>

          {previewItems.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {previewItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpen(item)}
                  className="relative aspect-square overflow-hidden rounded-xl border border-gray-800 bg-gray-950 hover:border-purple-600 transition-colors"
                >
                  {item.kind === "image" ? (
                    <img src={item.url} alt={item.prompt} className="h-full w-full object-cover" />
                  ) : (
                    <video src={item.url} className="h-full w-full object-cover" muted playsInline />
                  )}
                  <div className="absolute inset-0 bg-black/10" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {group.identityId ? (
              <Link href={`/identities/${group.identityId}`}>
                <Button className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Identity
                </Button>
              </Link>
            ) : (
              <Link href="/identities">
                <Button className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white">
                  <Crown className="h-4 w-4 mr-2" />
                  Link an Identity
                </Button>
              </Link>
            )}

            <Link href="/generate">
              <Button
                type="button"
                variant="outline"
                className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Generate More Like This
              </Button>
            </Link>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function IdentityGroupedVault(props: {
  groups: IdentityGroup[];
  onOpen: (item: LibraryItem) => void;
}) {
  if (props.groups.length === 0) {
    return (
      <Card className="border-gray-800 bg-gray-900/80">
        <CardContent className="py-14 text-center">
          <div className="space-y-3">
            <div className="mx-auto h-14 w-14 rounded-3xl bg-gray-950 border border-gray-800 flex items-center justify-center">
              <Layers3 className="w-6 h-6 text-gray-500" />
            </div>
            <h2 className="text-lg font-semibold text-gray-100">
              No identity groups match your filters
            </h2>
            <p className="text-sm text-gray-400">
              Try a different search term or switch your media filter.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {props.groups.map((group) => (
        <IdentityGroupCard key={group.key} group={group} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

function VaultModal(props: {
  item: LibraryItem | null;
  onClose: () => void;
}) {
  if (!props.item) return null;

  const item = props.item;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm p-4 md:p-6 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={props.onClose}
      >
        <motion.div
          className="w-full max-w-6xl rounded-3xl overflow-hidden border border-gray-800 bg-gray-950 shadow-[0_0_40px_rgba(168,85,247,0.25)]"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="bg-black flex items-center justify-center max-h-[82vh] overflow-hidden">
              {item.kind === "image" ? (
                <img
                  src={item.url}
                  alt={item.prompt}
                  className="w-full h-full object-contain"
                />
              ) : (
                <video
                  src={item.url}
                  className="w-full h-full object-contain"
                  controls
                  autoPlay
                  loop
                  muted
                />
              )}
            </div>

            <div className="border-l border-gray-800 bg-gray-950/90 p-5 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                      item.kind === "image"
                        ? "bg-pink-500/15 text-pink-200 border-pink-500/30"
                        : "bg-cyan-500/15 text-cyan-200 border-cyan-500/30"
                    }`}
                  >
                    {item.kind === "image" ? "IMAGE ASSET" : "VIDEO ASSET"}
                  </span>

                  {item.identityLora && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold border bg-yellow-500/10 text-yellow-200 border-yellow-500/25">
                      IDENTITY LINKED
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Vault Asset Details
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Review, reuse, or keep building around this identity.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-2">
                    Prompt
                  </p>
                  <p className="text-gray-200 leading-relaxed">
                    {item.prompt || "(No prompt saved)"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-2">
                      Created
                    </p>
                    <p className="text-gray-200">{formatDate(item.createdAt)}</p>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-2">
                      Mode
                    </p>
                    <p className="text-gray-200">{item.mode || "generation"}</p>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-2">
                      Body Mode
                    </p>
                    <p className="text-gray-200">{item.bodyMode || "Not stored"}</p>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400 mb-2">
                      Identity
                    </p>
                    <p className="text-gray-200 break-all">
                      {item.identityLora || "Not linked"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => downloadFile(item.url, `sirensforge-${item.kind}-${item.id}`)}
                  className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>

                {item.identityLora && (
                  <Link href={`/identities/${item.identityLora}`}>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
                    >
                      <Crown className="w-4 h-4 mr-2" />
                      View Identity
                    </Button>
                  </Link>
                )}

                <Link href="/generate">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate More Like This
                  </Button>
                </Link>

                <Button
                  type="button"
                  variant="outline"
                  onClick={props.onClose}
                  className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function LibraryClient({ items }: { items: LibraryItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [view, setView] = useState<ViewMode>("all");
  const [selected, setSelected] = useState<LibraryItem | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return [...items]
      .filter((item) => {
        const matchesFilter =
          filter === "all" ||
          (filter === "images" && item.kind === "image") ||
          (filter === "videos" && item.kind === "video");

        const haystack = [
          item.prompt,
          item.mode || "",
          item.bodyMode || "",
          item.identityLora || "",
          shortIdentityLabel(item.identityLora),
          item.status || "",
        ]
          .join(" ")
          .toLowerCase();

        const matchesQuery = !q || haystack.includes(q);

        return matchesFilter && matchesQuery;
      })
      .sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        const safeAt = Number.isNaN(at) ? 0 : at;
        const safeBt = Number.isNaN(bt) ? 0 : bt;
        return sort === "newest" ? safeBt - safeAt : safeAt - safeBt;
      });
  }, [items, query, filter, sort]);

  const identityGroups = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();

    for (const item of filtered) {
      const key = item.identityLora || "__no_identity__";
      const existing = map.get(key) || [];
      existing.push(item);
      map.set(key, existing);
    }

    const groups: IdentityGroup[] = Array.from(map.entries()).map(([key, groupItems]) => {
      const identityId = key === "__no_identity__" ? null : key;
      const imageCount = groupItems.filter((item) => item.kind === "image").length;
      const videoCount = groupItems.filter((item) => item.kind === "video").length;
      const heroItem = groupItems.find((item) => item.kind === "image") || groupItems[0] || null;
      const latestCreatedAt = groupItems[0]?.createdAt || null;

      return {
        key,
        identityId,
        title: shortIdentityLabel(identityId),
        subtitle: identityId
          ? "A growing collection tied to this AI Twin."
          : "Assets created without a linked identity.",
        items: groupItems,
        imageCount,
        videoCount,
        latestCreatedAt,
        heroItem,
      };
    });

    return groups.sort((a, b) => {
      if (a.identityId && !b.identityId) return -1;
      if (!a.identityId && b.identityId) return 1;
      const at = getGroupSortTime(a);
      const bt = getGroupSortTime(b);
      return sort === "newest" ? bt - at : at - bt;
    });
  }, [filtered, sort]);

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <LibraryHeader />

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-6">
        <VaultIntentBanner />
        <LibraryStats items={items} />

        <VaultToolbar
          query={query}
          filter={filter}
          sort={sort}
          view={view}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onSortChange={setSort}
          onViewChange={setView}
        />

        {items.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <Card className="border-gray-800 bg-gray-900/80">
            <CardContent className="py-14 text-center">
              <div className="space-y-3">
                <div className="mx-auto h-14 w-14 rounded-3xl bg-gray-950 border border-gray-800 flex items-center justify-center">
                  <Search className="w-6 h-6 text-gray-500" />
                </div>
                <h2 className="text-lg font-semibold text-gray-100">
                  No assets match your filters
                </h2>
                <p className="text-sm text-gray-400">
                  Try a different search term or switch your media filter.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : view === "identity" ? (
          <IdentityGroupedVault groups={identityGroups} onOpen={setSelected} />
        ) : (
          <VaultGrid items={filtered} onOpen={setSelected} />
        )}
      </main>

      <VaultModal item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
