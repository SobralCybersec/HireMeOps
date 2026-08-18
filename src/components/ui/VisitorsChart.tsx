import { useEffect, useRef } from "react";
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useThemeStore } from "../../stores/useThemeStore";

Chart.register(
  CategoryScale,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

const labels = ["Apr 2", "Apr 8", "Apr 14", "Apr 21", "Apr 28", "May 5", "May 12", "May 19"];
const primary = [
  22, 40, 29, 43, 36, 61, 42, 52, 38, 49, 31, 64, 51, 57, 44, 72, 62, 34, 47, 38, 65, 53, 69, 46,
  58, 41, 25, 55, 43, 31, 21, 48,
];
const secondary = [
  10, 16, 13, 24, 17, 29, 20, 27, 18, 24, 16, 34, 25, 30, 22, 38, 29, 17, 25, 19, 33, 27, 35, 24,
  31, 22, 14, 29, 20, 16, 12, 26,
];

export function VisitorsChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    Chart.getChart(canvas)?.destroy();

    const isLight = theme === "light";
    const fill = context.createLinearGradient(0, 0, 0, 230);
    fill.addColorStop(0, isLight ? "rgba(80, 80, 77, 0.2)" : "rgba(235, 235, 235, 0.38)");
    fill.addColorStop(1, isLight ? "rgba(80, 80, 77, 0)" : "rgba(235, 235, 235, 0)");

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: primary.map((_, index) => String(index)),
        datasets: [
          {
            data: primary,
            borderColor: isLight ? "#50504d" : "#d6d6d6",
            backgroundColor: fill,
            borderWidth: 1.2,
            fill: true,
            pointRadius: 0,
            tension: 0.38,
          },
          {
            data: secondary,
            borderColor: isLight ? "#858585" : "#b8b8b8",
            borderWidth: 1,
            fill: false,
            pointRadius: 0,
            tension: 0.38,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              autoSkip: false,
              color: isLight ? "#6b6b68" : "#777",
              callback: (_value, index) => (index % 4 === 0 ? labels[index / 4] : ""),
              font: { size: 10 },
              maxRotation: 0,
              minRotation: 0,
            },
          },
          y: {
            min: 0,
            max: 80,
            grid: { color: isLight ? "rgba(80,80,77,0.14)" : "rgba(255,255,255,0.07)" },
            border: { display: false },
            ticks: { display: false },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [theme]);

  return (
    <canvas ref={canvasRef} aria-label="Total visitors over the last three months" role="img" />
  );
}
