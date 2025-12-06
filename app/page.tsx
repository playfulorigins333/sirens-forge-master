'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const verified = localStorage.getItem('ageVerified');

    if (verified === 'true') {
      router.replace('/landing');
    } else {
      router.replace('/age-check');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p>Loading...</p>
    </div>
  );
}
