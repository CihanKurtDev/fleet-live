import { useEffect, useRef } from "react";

/*
 * Illustration for the landing page: roads, depot rings and vehicles in the
 * status colours, drawn on a canvas. Not real data; the page says so.
 */

type Road = [number, number][];

const COLORS = {
    background: "#0b0f16",
    major: "#253047",
    minor: "#1a2333",
    depotFill: "rgba(127,155,184,0.10)",
    depotLine: "rgba(127,155,184,0.55)",
    depotLabel: "rgba(206,218,232,0.8)",
    driving: "#4ade80",
    idle: "#fbbf24",
    stopped: "#94a3b8",
    offline: "#f87171",
};

const DEPOTS: [number, number, number, string][] = [
    [0.68, 0.36, 0.07, "Köln"],
    [0.84, 0.66, 0.055, "Bonn"],
    [0.55, 0.72, 0.05, "Düren"],
];

/** Same picture on every visit: a seeded random generator. */
const seeded = (seed: number) => {
    let state = seed;
    return () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
};

const at = (road: Road, t: number): [number, number] => {
    const n = road.length - 1;
    const x = Math.min(Math.max(t, 0), 0.9999) * n;
    const i = Math.floor(x);
    const f = x - i;
    return [
        road[i][0] + (road[i + 1][0] - road[i][0]) * f,
        road[i][1] + (road[i + 1][1] - road[i][1]) * f,
    ];
};

export const HeroMapCanvas = ({ className }: { className?: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");

        if (!canvas || !ctx) {
            return;
        }

        const rand = seeded(7);
        const roads: Road[] = Array.from({ length: 9 }, (_, i) => {
            const horizontal = i % 2 === 0;
            const base = 0.1 + rand() * 0.8;
            return Array.from({ length: 9 }, (_, k) => {
                const t = k / 8;
                const wobble = (rand() - 0.5) * 0.12;
                return horizontal
                    ? [t * 1.2 - 0.1, base + wobble]
                    : [base + wobble, t * 1.2 - 0.1];
            });
        });
        const palette = [
            COLORS.driving,
            COLORS.driving,
            COLORS.driving,
            COLORS.idle,
            COLORS.idle,
            COLORS.stopped,
            COLORS.offline,
        ];
        const vehicles = Array.from({ length: 120 }, () => {
            const color = palette[Math.floor(rand() * palette.length)];
            const speed =
                (0.00012 + rand() * 0.0004) * (rand() > 0.5 ? 1 : -1);
            return {
                road: Math.floor(rand() * roads.length),
                t: rand(),
                // Only driving vehicles move, each at its own pace.
                v: color === COLORS.driving ? speed : 0,
                color,
            };
        });

        let width = 0;
        let height = 0;
        let frame = 0;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const draw = () => {
            ctx.fillStyle = COLORS.background;
            ctx.fillRect(0, 0, width, height);
            ctx.lineCap = "round";

            roads.forEach((road, i) => {
                ctx.beginPath();
                road.forEach(([x, y], k) =>
                    k ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height),
                );
                ctx.strokeStyle = i < 3 ? COLORS.major : COLORS.minor;
                ctx.lineWidth = i < 3 ? 3 : 2;
                ctx.stroke();
            });

            for (const [x, y, r, name] of DEPOTS) {
                const radius = r * Math.max(width, height);
                ctx.beginPath();
                ctx.arc(x * width, y * height, radius, 0, Math.PI * 2);
                ctx.fillStyle = COLORS.depotFill;
                ctx.fill();
                ctx.strokeStyle = COLORS.depotLine;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = COLORS.depotLabel;
                ctx.font = '600 11px "IBM Plex Mono", monospace';
                ctx.textAlign = "center";
                ctx.fillText(name.toUpperCase(), x * width, y * height + radius + 16);
            }

            for (const vehicle of vehicles) {
                const [x, y] = at(roads[vehicle.road], vehicle.t);
                ctx.beginPath();
                ctx.arc(
                    x * width,
                    y * height,
                    vehicle.color === COLORS.offline ? 3.6 : 2.8,
                    0,
                    Math.PI * 2,
                );
                ctx.fillStyle = vehicle.color;
                ctx.fill();
            }
        };

        const tick = () => {
            for (const vehicle of vehicles) {
                vehicle.t += vehicle.v;
                if (vehicle.t > 1 || vehicle.t < 0) {
                    vehicle.v = -vehicle.v;
                }
            }
            draw();
            frame = requestAnimationFrame(tick);
        };

        const observer = new ResizeObserver(() => {
            resize();
            draw();
        });
        observer.observe(canvas);
        resize();
        draw();

        const still =
            typeof window.matchMedia !== "function" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!still) {
            frame = requestAnimationFrame(tick);
        }

        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, []);

    return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
};
