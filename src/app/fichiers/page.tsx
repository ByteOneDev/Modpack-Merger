"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** Ancienne adresse de l'etape : les conflits de fichiers vivent dans le centre de conflits. */
export default function FilesRedirect() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/conflits/");
  }, [router]);
  return null;
}
