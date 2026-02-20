"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function McpRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/extensions?tab=mcp");
  }, [router]);
  return null;
}
