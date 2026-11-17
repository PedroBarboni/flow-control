/**
 * Ícones funcionais em SVG, padronizados em traço de 1.6 e caixa de 24px.
 * Nenhum emoji é usado como ícone na interface.
 */

const PATHS: Record<string, string[]> = {
  search: ["M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6Z", "m15.5 15.5 4.2 4.2"],
  alert: ["M12 4.5 2.8 20h18.4L12 4.5Z", "M12 10v4.4", "M12 17.2h.01"],
  critical: ["M8.4 3h7.2L21 8.4v7.2L15.6 21H8.4L3 15.6V8.4L8.4 3Z", "M12 8v4.6", "M12 16h.01"],
  check: ["m4.5 12.4 4.8 4.8L19.5 7"],
  clock: ["M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z", "M12 7.4V12l3.2 2"],
  pause: ["M9.2 5.5v13", "M14.8 5.5v13"],
  play: ["M7.5 5.2v13.6L18.5 12 7.5 5.2Z"],
  package: ["M3.5 7.6 12 3.2l8.5 4.4v8.8L12 20.8 3.5 16.4V7.6Z", "M3.5 7.6 12 12l8.5-4.4", "M12 12v8.8"],
  layers: ["M12 3.4 3.2 8 12 12.6 20.8 8 12 3.4Z", "m3.2 12.8 8.8 4.6 8.8-4.6"],
  route: ["M5 4v10.5a3 3 0 0 0 3 3h8.4", "m13.8 14.1 3 3.4-3 3.4", "M5 4h4"],
  factory: ["M3.4 20.4h17.2", "M4.6 20.4V9.6l5 3.2v-3.2l5 3.2V6.2h4.8v14.2", "M8.6 16.6h2", "M14 16.6h2"],
  scale: ["M12 4.4v15.2", "M6.6 6.4h10.8", "m6.6 6.4-3 6.4h6l-3-6.4Z", "m17.4 6.4-3 6.4h6l-3-6.4Z", "M8.4 19.6h7.2"],
  database: ["M12 3.6c4.1 0 7.4 1.2 7.4 2.6S16.1 8.8 12 8.8 4.6 7.6 4.6 6.2 7.9 3.6 12 3.6Z", "M4.6 6.2v11.6c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6V6.2", "M4.6 12c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6"],
  arrowRight: ["M4.6 12h14", "m13.4 6.6 5.4 5.4-5.4 5.4"],
  arrowLeft: ["M19.4 12h-14", "m10.6 6.6-5.4 5.4 5.4 5.4"],
  chevronDown: ["m6.4 9.4 5.6 5.6 5.6-5.6"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  plus: ["M12 5.2v13.6", "M5.2 12h13.6"],
  save: ["M5 4.6h11.2L19.4 7.8V19.4H5V4.6Z", "M8.4 4.6v5h7v-5", "M8.4 19.4v-5.6h7.2v5.6"],
  trash: ["M4.8 6.8h14.4", "M9.4 6.8V4.6h5.2v2.2", "M6.6 6.8 7.6 20h8.8l1-13.2", "M10.4 10.4v6", "M13.6 10.4v6"],
  refresh: ["M20 12a8 8 0 1 1-2.6-5.9", "M20.2 4.2v4.6h-4.6"],
  info: ["M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z", "M12 11v5.2", "M12 7.8h.01"],
  filter: ["M4 5.4h16", "M7.4 11.2h9.2", "M10.4 17h3.2"],
  lot: ["M4.4 5.6h15.2v12.8H4.4V5.6Z", "M4.4 10h15.2", "M9.4 10v8.4"],
  wip: ["M4 18.8h16", "M6.6 18.8v-6.2", "M11.2 18.8V7.4", "M15.8 18.8v-9", "M20.2 18.8V4.6"],
};

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  className?: string;
  size?: number;
  title?: string;
}

export default function Icon({ name, className, size = 20, title }: IconProps) {
  const paths = PATHS[name] ?? PATHS.info;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
