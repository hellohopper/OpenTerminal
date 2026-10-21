"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import DisplayPreferences from "../components/DisplayPreferences";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 10_000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}><DisplayPreferences />{children}</QueryClientProvider>;
}
