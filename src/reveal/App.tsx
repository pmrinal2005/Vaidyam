import { motion, useMotionTemplate, useScroll, useTransform, useAnimationFrame, useMotionValue } from 'motion/react';
import { useRef } from 'react';
import OrbitImages from './components/OrbitImages';

const orbitImagesData = [
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/3644e7bae80f5a458c3c087d313204cc67952aff.3644e7ba.png",
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/85346ab4899007b001b3df5d5da04a9d0e4e9ea4.85346ab4.png",
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/ff5f9bb7c566be349d20a775a29eab9ff591311b.ff5f9bb7.png",
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/22e1b6bbc71c4977a49b6bbd991ed75be483cf0e.22e1b6bb.png",
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/874d9530b2ec45092a4c71a1fd74564599b7e3c8.874d9530.png",
  "https://aspect-slam-99684872.figma.site/_components/v2/79eebc3801de595030a9e7fa875de4a77ede4f07/2adc4a2c178d6aaa68dda80fc42e7628372522d1.2adc4a2c.png",
];

/**
 * BACKGROUND NOTE (Mux HLS removal → SOLID BLACK backdrop)
 * --------------------------------------------------------
 * The reveal previously streamed an external Mux HLS manifest
 * (stream.mux.com/…m3u8) behind the orbit gallery. That dependency is removed
 * completely: no <video>, no <source>, no hls.js loader, no preconnect, no
 * external stream request of any kind. It is replaced by `.reveal-backdrop` —
 * a SOLID BLACK (#000) layer defined in index.css that occupies the exact same
 * box and z-index the <video> occupied.
 *
 * Why solid black rather than another stream or a gradient:
 *  • zero third-party network dependency — the m3u8 could 403/expire at any
 *    time, which is precisely what made this section fragile;
 *  • no hls.js bundle (~140 KB) and no autoplay-policy failure paths;
 *  • nothing paints or composites behind the orbit, so the scroll-driven
 *    Framer Motion timeline keeps its whole frame budget on mobile;
 *  • maximum contrast for the white clip-path panel that irises open over it,
 *    which IS the opening motion-graphic transition.
 *
 * The opening motion graphic itself is untouched: it is the Framer Motion
 * timeline below (the `clipPath` ellipse iris + the orbit gallery's radius /
 * spread / item-size / rotation / focus choreography), not the backdrop.
 *
 * CRITICAL: every Framer Motion value, keyframe array, offset and z-index in
 * this component is byte-for-byte the spec's. Only the backdrop layer changed.
 */
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const rx = useTransform(scrollYProgress, [0, 0.08, 1], ["0%", "55%", "55%"]);
  const ry = useTransform(scrollYProgress, [0, 0.08, 1], ["0%", "55%", "55%"]);
  const clipPath = useMotionTemplate`ellipse(${rx} ${ry} at 50% 50%)`;

  const textOpacity = useTransform(scrollYProgress, [0.03, 0.08, 0.15, 0.22, 0.90, 0.98, 1], [0, 1, 1, 0, 0, 1, 1]);
  const textBlurVal = useTransform(scrollYProgress, [0.03, 0.08, 0.15, 0.22, 0.90, 0.98, 1], [15, 0, 0, 15, 15, 0, 0]);
  const filterText = useMotionTemplate`blur(${textBlurVal}px)`;
  const yElement = useTransform(scrollYProgress, [0.03, 0.08, 0.15, 0.22, 0.90, 0.98, 1], [20, 0, 0, 20, 20, 0, 0]);

  const targetRadius = 650;

  const orbitItemSize = useTransform(scrollYProgress, [0.15, 0.25, 0.85, 0.95, 1], [80, 520, 520, 80, 80]);
  const orbitRx = useTransform(scrollYProgress,       [0.15, 0.25, 0.85, 0.95, 1], [330, targetRadius, targetRadius, 330, 330]);
  const orbitRy = useTransform(scrollYProgress,       [0.15, 0.25, 0.85, 0.95, 1], [140, targetRadius, targetRadius, 140, 140]);
  const orbitRotation = useTransform(scrollYProgress, [0.15, 0.25, 0.85, 0.95, 1], [-15, 0, 0, -15, -15]);
  const orbitTx = useTransform(scrollYProgress,       [0.15, 0.25, 0.85, 0.95, 1], [0, -targetRadius, -targetRadius, 0, 0]);
  const focusStrength = useTransform(scrollYProgress, [0.15, 0.25, 0.85, 0.95, 1], [0, 1, 1, 0, 0]);

  const orbitProgress = useMotionValue(0);
  const prevScroll = useRef(0);

  useAnimationFrame((time, delta) => {
     const pos = scrollYProgress.get();
     const scrollDelta = pos - prevScroll.current;
     prevScroll.current = pos;

     let frameSpeed = 0;
     if (pos > 0.15 && pos < 0.85) {
        frameSpeed = (scrollDelta * 200);
     } else {
        frameSpeed = (delta / 1000) * 2.5;
     }

     orbitProgress.set(orbitProgress.get() + frameSpeed);
  });

  return (
    <div ref={containerRef} className="relative w-full h-[600vh] bg-black">
      <div className="sticky top-0 w-full h-screen overflow-hidden text-white">

        {/* Solid black backdrop — replaces the removed Mux HLS <video>.
            Occupies the exact same box and z-index the video did. No child
            layers, no animation, no network request. */}
        <div className="reveal-backdrop absolute inset-0 w-full h-full z-0" aria-hidden="true" />

        <div className="absolute inset-0 bg-black/10 z-0"></div>

        <motion.div
          className="absolute z-20 flex items-center justify-center overflow-hidden"
          style={{ clipPath, rotate: -15, width: '150vw', height: '150vh', left: '-25vw', top: '-25vh' }}
        >
          <div className="absolute inset-0 bg-white" />
          <div className="relative flex flex-col items-center justify-center" style={{ width: '100vw', height: '100vh', transform: 'rotate(15deg)' }}>
            <motion.div className="w-[90vw] max-w-[1200px] aspect-square relative z-0">
              <OrbitImages
                images={orbitImagesData}
                shape="ellipse"
                direction="normal"
                duration={40}
                fill={true}
                showPath={false}
                responsive={true}
                baseWidth={800}
                progressOverride={orbitProgress}
                radiusXOverride={orbitRx}
                radiusYOverride={orbitRy}
                itemSizeOverride={orbitItemSize}
                rotationOverride={orbitRotation}
                translateXOverride={orbitTx}
                focusStrength={focusStrength}
              />
            </motion.div>
          </div>
        </motion.div>

        <div className="absolute inset-0 z-[60] pointer-events-none">
            <div id="reveal-center-text" className="absolute top-[48%] left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50">
              <motion.div
                className="flex flex-col items-center whitespace-nowrap pointer-events-auto"
                style={{ filter: filterText, opacity: textOpacity, WebkitFontSmoothing: 'antialiased', WebkitBackfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
              >
                <div className="flex items-baseline text-black leading-none mb-1">
                  <span className="font-serif text-[45px] md:text-[55px] italic tracking-tight text-black">M</span>
                  <span className="font-serif text-[45px] md:text-[55px] tracking-tight text-black">aster the Elements</span>
                </div>
                <span className="font-sans text-[28px] md:text-[36px] tracking-tight text-black mt-[-5px]">embrace</span>
              </motion.div>
            </div>

            <motion.div
              id="reveal-tag-2k26"
              className="absolute top-32 right-[calc(6vw+150px)] md:right-[214px] flex flex-col items-start text-left pointer-events-auto cursor-text"
              style={{ y: yElement, filter: filterText, opacity: textOpacity }}
            >
              <span className="font-serif text-[40px] leading-none mb-3 text-black">2K26</span>
              <span className="font-serif text-[16px] uppercase tracking-widest text-black leading-[20px] text-left">
                JOIN AN EXCLUSIVE<br />COMMUNITY
              </span>
            </motion.div>

            <motion.div
              id="reveal-tag-collection"
              className="absolute bottom-8 left-8 md:bottom-16 md:left-16 flex flex-col items-start text-black pointer-events-auto cursor-text"
              style={{ y: yElement, filter: filterText, opacity: textOpacity }}
            >
              <span className="font-serif text-[40px] leading-none mb-1 text-black">0651</span>
              <span className="font-serif text-[16px] uppercase tracking-widest text-black">COLLECTION</span>
            </motion.div>

            <div id="reveal-cta-block" className="absolute bottom-16 right-[6vw] md:right-[10vw] flex flex-col items-start z-10 pointer-events-auto">
              <motion.p
                className="font-serif text-[16px] uppercase tracking-widest text-black leading-[20px] mb-6 text-left w-[240px] cursor-text"
                style={{ y: yElement, filter: filterText, opacity: textOpacity }}
              >
                JOIN AN EXCLUSIVE COMMUNITY OF SAILORS. WHETHER YOU CRAVE THE THRILL OF THE OPEN
              </motion.p>
              <motion.div className="flex gap-0 pointer-events-auto items-center" style={{ y: yElement, filter: filterText, opacity: textOpacity }}>
                {/* Both CTAs enter the Catena dashboard. */}
                <a
                  href="/dashboard"
                  data-enter-dashboard
                  className="bg-black hover:bg-black/90 transition-colors text-white rounded-[40px] px-8 py-3.5 font-serif tracking-[0.1em] uppercase text-[12px] md:text-[14px] z-10 inline-block no-underline"
                >
                  BUY COLLECTION
                </a>
                <a
                  href="/dashboard"
                  data-enter-dashboard
                  aria-label="Open the Catena causal health dashboard"
                  className="bg-black hover:bg-black/90 transition-colors w-[46px] h-[46px] flex items-center justify-center rounded-[50%] text-white -ml-2 z-0 no-underline"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ml-1">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </a>
              </motion.div>
            </div>
        </div>

      </div>
    </div>
  );
}
