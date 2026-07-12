import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Cinzel, IBM_Plex_Mono, Inter, JetBrains_Mono, Orbitron } from "next/font/google";
import { Toaster } from "sonner";
import { TRPCReactProvider } from "~/clients/trpc";
import { ThemeProvider } from "~/components/core/theme-provider";

const primary = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const code = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600", "700"],
});
const display = Cinzel({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800", "900"],
  display: "swap",
});
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-orbitron" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "fuguBrow",
  description: "GH0ST CAPTAIN — your rogue AI first mate.",
};

export const viewport: Viewport = {
  themeColor: "#020808",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${primary.variable} ${code.variable} ${display.variable} ${orbitron.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="bg-background min-h-screen font-sans antialiased">
        <ThemeProvider>
          <TRPCReactProvider>
            {children}
            <Toaster />
            <div id="dialog-portal" />
          </TRPCReactProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
