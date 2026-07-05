import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, VT323 } from "next/font/google";
import "./globals.css";

const pixelify = Pixelify_Sans({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const vt323 = VT323({
  variable: "--font-pixel-body",
  subsets: ["latin"],
  weight: "400",
});

const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
  title: "cabo! | pastel pixel card game",
  description: "A cute pixel-art multiplayer card game. Share a code, peek fast, snap faster, call cabo.",
  openGraph: {
    title: "cabo! | pastel pixel card game",
    description: "Share a code, peek fast, snap faster, call cabo.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "cabo! | pastel pixel card game",
    description: "Share a code, peek fast, snap faster, call cabo.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fdf3ec",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pixelify.variable} ${vt323.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
