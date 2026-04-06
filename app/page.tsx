'use client';

import { AuthProvider } from '@/components/AuthProvider';
import TravelAssistant from '@/components/TravelAssistant';

export default function Home() {
  return (
    <AuthProvider>
      <TravelAssistant />
    </AuthProvider>
  );
}
