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

const metadataBase = new URL("https://cabocards.online");
const previewAlt = "cabo! pastel pixel-art multiplayer card game preview";

export const metadata: Metadata = {
  metadataBase,
  title: "cabo! | pastel pixel card game",
  description: "A cute pixel-art multiplayer card game. Share a code, peek fast, snap faster, call cabo.",
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "cabo",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "cabo! | pastel pixel card game",
    description: "Share a code, peek fast, snap faster, call cabo.",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: previewAlt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "cabo! | pastel pixel card game",
    description: "Share a code, peek fast, snap faster, call cabo.",
    images: [
      {
        url: "/twitter-image",
        alt: previewAlt,
      },
    ],
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
  // page analytics (optional): set NEXT_PUBLIC_GOATCOUNTER to your endpoint,
  // e.g. https://cabo.goatcounter.com/count — no cookies, GDPR-friendly
  const goatcounter = process.env.NEXT_PUBLIC_GOATCOUNTER;
  return (
    <html lang="en" className={`${pixelify.variable} ${vt323.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        {goatcounter && (
          <script data-goatcounter={goatcounter} async src="https://gc.zgo.at/count.js" />
        )}
      </body>
    </html>
  );
}
