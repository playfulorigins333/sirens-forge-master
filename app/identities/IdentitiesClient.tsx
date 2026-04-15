"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Crown,
  Sparkles,
  Search,
  Filter,
  Image as ImageIcon,
  Video as VideoIcon,
  Dna,
  Shield,
  Star,
  ArrowRight,
  Wand2,
} from "lucide-react";
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

export type IdentityCardItem = {
  id: string;
  name: string;
  status: string;
  triggerToken: string | null;
  createdAt: string;
  completedAt: string | null;
  progress: number | null;
  imageCount: number;
  videoCount: number;
  totalAssets: number;
  datasetImageCount: number | null;
  coverUrl: string | null;
  artifactKey: string | null;
};

type StatusFilter = "all" | "completed" | "draft" | "queued" | "training" | "failed";
type SortMode = "newest" | "oldest" | "most-assets";

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

function statusTone(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-500/30";
    case "training":
      return "bg-cyan-500/15 text-cyan-200 border-cyan-500/30";
    case "queued":
      return "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
    case "draft":
      return "bg-gray-500/15 text-gray-200 border-gray-500/30";
    case "failed":
      return "bg-rose-500/15 text-rose-200 border-rose-500/30";
    default:
      return "bg-purple-500/15 text-purple-200 border-purple-500/30";
    }
}

function IdentityHeader() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/70 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            My Identities
          </h1>
          <p className="text-xs md:text-sm text-gray-300 mt-1">
            Train and manage your AI Twins for consistent, on-demand content.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 text-black text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.35)]">
            <Dna className="w-3 h-3" />
            IDENTITY-FIRST
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

function IdentityStats({ items }: { items: IdentityCardItem[] }) {
  const totalIdentities = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const totalAssets = items.reduce((sum, i) => sum + i.totalAssets, 0);
  const withAssets = items.filter((i) => i.totalAssets > 0).length;

  const cards = [
    {
      label: "Total Identities",
      value: totalIdentities,
      icon: Dna,
      glow: "from-purple-500/25 via-pink-500/10 to-cyan-500/25",
      border: "border-purple-900/40",
      text: "text-purple-200",
    },
    {
      label: "Completed",
      value: completed,
      icon: Shield,
      glow: "from-emerald-500/20 via-green-500/10 to-transparent",
      border: "border-emerald-900/40",
      text: "text-emerald-200",
    },
    {
      label: "Assets Linked",
      value: totalAssets,
      icon: Sparkles,
      glow: "from-cyan-500/20 via-blue-500/10 to-transparent",
      border: "border-cyan-900/40",
      text: "text-cyan-200",
    },
    {
      label: "In Active Use",
      value: withAssets,
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

function IdentityToolbar(props: {
  query: string;
  status: StatusFilter;
  sort: SortMode;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onSortChange: (value: SortMode) => void;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm md:text-base flex items-center gap-2">
          <Filter className="w-4 h-4 text-purple-300" />
          Identity Controls
        </CardTitle>
        <CardDescription className="text-xs text-gray-300">
          Search, sort, and organize the AI Twins you’ve trained.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by identity name, token, or status..."
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            className="pl-10 bg-gray-950 border-gray-700 text-gray-100 placeholder:text-gray-500 h-10"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select value={props.status} onValueChange={(v) => props.onStatusChange(v as StatusFilter)}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-10 text-sm text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="training">Training</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={props.sort} onValueChange={(v) => props.onSortChange(v as SortMode)}>
            <SelectTrigger className="bg-gray-950 border-gray-800 h-10 text-sm text-gray-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-gray-950 border-gray-800 text-gray-100">
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="most-assets">Most Assets</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-gray-800 bg-gray-900/80">
      <CardContent className="py-16">
        <div className="text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-3xl bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-800/40 flex items-center justify-center">
            <Dna className="w-8 h-8 text-purple-300" />
          </div>

          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
              No identities yet
            </h2>
            <p className="text-sm text-gray-400 mt-2 max-w-xl mx-auto">
              Train your AI Twin once — then generate content that looks like you anytime you want.
            </p>
          </div>

          <div className="pt-2">
            <Link href="/lora/train">
              <Button className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white shadow-[0_0_24px_rgba(168,85,247,0.35)]">
                <Wand2 className="w-4 h-4 mr-2" />
                Train Identity
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IdentityGrid({ items }: { items: IdentityCardItem[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {items.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: index * 0.03 }}
        >
          <Link href={`/identities/${item.id}`}>
            <Card className="h-full overflow-hidden border-gray-800 bg-gray-900/80 hover:border-purple-700/50 hover:shadow-[0_0_28px_rgba(168,85,247,0.12)] transition-all cursor-pointer">
              <div className="relative aspect-[16/10] bg-gray-950 overflow-hidden">
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={item.name}
                    className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-cyan-500/10 flex items-center justify-center">
                    <div className="h-16 w-16 rounded-3xl bg-black/30 border border-white/10 flex items-center justify-center">
                      <Dna className="w-8 h-8 text-purple-300" />
                    </div>
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/10" />

                <div className="absolute top-3 left-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${statusTone(
                      item.status
                    )}`}
                  >
                    {item.status.toUpperCase()}
                  </span>
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-lg font-bold text-white line-clamp-1">
                    {item.name}
                  </h3>
                  <p className="text-[11px] text-gray-300 mt-1">
                    {item.totalAssets > 0
                      ? `${item.totalAssets} linked asset${item.totalAssets === 1 ? "" : "s"}`
                      : "No linked assets yet"}
                  </p>
                </div>
              </div>

              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-center">
                    <div className="flex justify-center mb-1">
                      <ImageIcon className="w-4 h-4 text-pink-300" />
                    </div>
                    <p className="text-lg font-bold text-pink-200">{item.imageCount}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400">
                      Images
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-center">
                    <div className="flex justify-center mb-1">
                      <VideoIcon className="w-4 h-4 text-cyan-300" />
                    </div>
                    <p className="text-lg font-bold text-cyan-200">{item.videoCount}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400">
                      Videos
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-800 bg-gray-950 p-3 text-center">
                    <div className="flex justify-center mb-1">
                      <Star className="w-4 h-4 text-yellow-300" />
                    </div>
                    <p className="text-lg font-bold text-yellow-200">
                      {item.datasetImageCount ?? 0}
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400">
                      Training
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Trigger token</span>
                    <span className="text-gray-200 font-medium">
                      {item.triggerToken || "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Created</span>
                    <span className="text-gray-200 font-medium">
                      {formatRelative(item.createdAt)}
                    </span>
                  </div>

                  {typeof item.progress === "number" && item.status === "training" && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Progress</span>
                      <span className="text-cyan-200 font-medium">{item.progress}%</span>
                    </div>
                  )}
                </div>

                <div className="pt-1">
                  <div className="flex items-center justify-between rounded-xl border border-purple-900/30 bg-purple-500/5 px-3 py-2">
                    <span className="text-xs text-purple-200 font-medium">
                      Open identity workspace
                    </span>
                    <ArrowRight className="w-4 h-4 text-purple-300" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

export default function IdentitiesClient({ items }: { items: IdentityCardItem[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortMode>("newest");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return [...items]
      .filter((item) => {
        const matchesStatus = status === "all" || item.status === status;
        const haystack = [
          item.name,
          item.status,
          item.triggerToken || "",
          item.artifactKey || "",
        ]
          .join(" ")
          .toLowerCase();

        const matchesQuery = !q || haystack.includes(q);

        return matchesStatus && matchesQuery;
      })
      .sort((a, b) => {
        if (sort === "most-assets") {
          return b.totalAssets - a.totalAssets;
        }

        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return sort === "newest" ? bt - at : at - bt;
      });
  }, [items, query, status, sort]);

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <IdentityHeader />

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-6">
        <IdentityStats items={items} />
        <IdentityToolbar
          query={query}
          status={status}
          sort={sort}
          onQueryChange={setQuery}
          onStatusChange={setStatus}
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
                  No identities match your filters
                </h2>
                <p className="text-sm text-gray-400">
                  Try a different search or switch your status filter.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <IdentityGrid items={filtered} />
        )}
      </main>
    </div>
  );
}