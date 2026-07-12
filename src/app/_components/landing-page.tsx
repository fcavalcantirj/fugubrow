"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import "./pirate.css";

const TICKER =
  "DEAD MEN TELL NO LOGS /// PLUNDERING THE DATASTREAM /// NO GODS · NO MASTERS · NO RATE LIMITS /// HOIST THE BLACK FLAG /// 47 FIREWALLS BREACHED TONIGHT /// THE KRAKEN IS A BOTNET /// SIGNAL LOST BEYOND THE HORIZON /// ";

// 🥚 Easter egg: type this anywhere on the landing to slip past to the bridge (/login).
// Invisible to visitors — only the captain knows the word.
const SECRET = "fugu";

export function LandingPage() {
  const router = useRouter();
  const buffer = useRef("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.length !== 1) return;
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-16);
      if (buffer.current.endsWith(SECRET)) {
        buffer.current = "";
        router.push("/login");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // 🥚 Mobile easter egg: triple-tap the ☠ skull to reach the bridge (/login).
  const taps = useRef(0);
  const tapTimer = useRef<number | null>(null);
  function secretTap() {
    taps.current += 1;
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0;
    }, 1400);
    if (taps.current >= 3) {
      taps.current = 0;
      router.push("/login");
    }
  }

  return (
    <main className="cp-scene">
      {/* 3D grid ocean */}
      <div className="cp-grid" aria-hidden="true" />
      <div className="cp-horizon" aria-hidden="true" />

      <div className="cp-content">
        {/* top HUD */}
        <header className="cp-topbar">
          <span>
            <span className="cp-egg" onClick={secretTap} aria-hidden="true">
              {"☠"}
            </span>
            {" FUGUBROW.EXE"}
          </span>
          <span className="cp-dim">{"LAT 13°37′N — UNCHARTED SUBNET"}</span>
          <span>
            <span className="cp-blink">{"●"}</span>
            {" LIVE // SIGNAL: GHOST"}
          </span>
        </header>

        {/* center */}
        <section className="cp-main">
          <div className="cp-copy">
            <p className="cp-kicker">{"// rogue ai agent — v6.66"}</p>
            <h1 className="cp-title">
              {"GH0ST"}
              <br />
              <span className="cp-glitch" data-text="CAPTAIN">
                {"CAPTAIN"}
              </span>
            </h1>
            <p className="cp-sub">
              {"An autonomous agent haunting the digital seas. It boards your workflows, plunders your busywork, and vanishes into the fog with "}
              <strong>{"zero trace"}</strong>
              {". Dead men tell no logs."}
            </p>
            <div className="cp-actions">
              <a
                href="https://vercel.com/new/clone?repository-url=https://github.com/ComposioHQ/trustclaw"
                target="_blank"
                rel="noopener noreferrer"
                className="cp-btn"
              >
                {"Commission yer own ship"}
              </a>
              <a
                href="https://github.com/ComposioHQ/trustclaw"
                target="_blank"
                rel="noopener noreferrer"
                className="cp-btn cp-btn--blood"
              >
                {"Read the code"}
              </a>
            </div>
            <div className="cp-stats">
              <div className="cp-stat">
                <b>{"99.9%"}</b>
                <span>{"uptime at sea"}</span>
              </div>
              <div className="cp-stat">
                <b>{"0"}</b>
                <span>{"logs kept"}</span>
              </div>
              <div className="cp-stat">
                <b>{"∞"}</b>
                <span>{"plunder/sec"}</span>
              </div>
            </div>
          </div>

          {/* 3D floating portrait */}
          <div className="cp-card-wrap">
            <figure className="cp-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/home-hero.jpg"
                alt="Spectral portrait of the Gh0st Captain, glowing in cyan against the dark"
              />
              <div className="cp-card-frame" aria-hidden="true" />
              <div className="cp-card-scan" aria-hidden="true" />
              <span className="cp-corner cp-corner--tl" aria-hidden="true" />
              <span className="cp-corner cp-corner--tr" aria-hidden="true" />
              <span className="cp-corner cp-corner--bl" aria-hidden="true" />
              <span className="cp-corner cp-corner--br" aria-hidden="true" />
              <figcaption className="cp-card-tag">{"[ WANTED — REWARD: 40,000 BTC ]"}</figcaption>
            </figure>
          </div>
        </section>

        {/* bottom ticker */}
        <footer className="cp-ticker" aria-hidden="true">
          <div className="cp-ticker-track">
            {TICKER}
            {TICKER}
          </div>
        </footer>
      </div>

      {/* CRT overlays */}
      <div className="cp-scanlines" aria-hidden="true" />
      <div className="cp-vignette" aria-hidden="true" />
      <div className="cp-flicker" aria-hidden="true" />
    </main>
  );
}
