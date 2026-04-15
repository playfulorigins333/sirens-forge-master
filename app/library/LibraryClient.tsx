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

function LibraryHeader() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/70 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Your Content Vault
          </h1>
          <p className="text-xs md:text-sm text-gray-300 mt-1">
            Your creations. Your identities. Your power.
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

          <div className="pt-2">
            <Link href="/generate">
              <Button className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.35)]">
                <Sparkles className="w-4 h-4 mr-2" />
                Open Generator
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
  onQueryChange: (value: string) => void;
  onFilterChange: (value: FilterMode) => void;
  onSortChange: (value: SortMode) => void;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base flex items-center gap-2">
          <Filter className="w-4 h-4 text-purple-300" />
          Vault Controls
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          Search, sort, and narrow your private asset library.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by prompt, mode, or identity..."
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

function VaultGrid(props: {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {props.items.map((item, index) => (
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
                onClick={() => props.onOpen(item)}
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
              <div className="flex items-center gap-2 mb-2">
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
                <div className="flex items-center gap-2 mb-3">
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
                  Review, archive mentally, or reuse later from your private vault.
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
                      Status
                    </p>
                    <p className="text-gray-200">{item.status}</p>
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
        return sort === "newest" ? bt - at : at - bt;
      });
  }, [items, query, filter, sort]);

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <LibraryHeader />

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-6">
        <LibraryStats items={items} />

        <VaultToolbar
          query={query}
          filter={filter}
          sort={sort}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onSortChange={setSort}
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
        ) : (
          <VaultGrid items={filtered} onOpen={setSelected} />
        )}
      </main>

      <VaultModal item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}