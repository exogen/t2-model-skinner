import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./global.css";

export const metadata = {
  title: "T2 Model Viewer & Skinner",
  description: "Get skinned. 😎",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
