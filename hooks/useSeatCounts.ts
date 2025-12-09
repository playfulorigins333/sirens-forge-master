"use client";

import { useEffect, useState } from "react";

export interface SeatCounts {
  og: number;
  earlyBird: number;
  prime: number;
}

export function useSeatCounts() {
  const [seats, setSeats] = useState<SeatCounts>({
    og: 0,
    earlyBird: 0,
    prime: 0,
  });

  const fetchSeats = async () => {
    try {
      const res = await fetch("/api/subscription/seat-count", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("Seat count API error:", res.status);
        return;
      }

      const data = await res.json();

      setSeats({
        og: data.og || 0,
        earlyBird: data.earlyBird || 0,
        prime: data.prime || 0,
      });
    } catch (err) {
      console.error("Seat count fetch failed:", err);
    }
  };

  useEffect(() => {
    fetchSeats();

    // Poll every 10 seconds
    const interval = setInterval(fetchSeats, 10_000);
    return () => clearInterval(interval);
  }, []);

  return seats;
}
