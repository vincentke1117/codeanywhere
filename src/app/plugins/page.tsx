"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PluginsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/extensions");
  }, [router]);
  return null;
}
