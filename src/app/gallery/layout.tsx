import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Tribes 2 Skin Gallery",
};

export default function GalleryLayout({ children }: { children: ReactNode }) {
  return children;
}
