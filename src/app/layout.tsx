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
      <body>{children}</body>
    </html>
  );
}
