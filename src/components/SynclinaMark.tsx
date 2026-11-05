import { useId } from "react";

/**
 * The Synclina "S" mark — two interlocking strokes, traced from the
 * official logo artwork. Upper piece = top bar + left bowl, lower piece =
 * middle bar + right bowl + slanted base.
 */
export const MARK_PATHS = {
  upper:
    "M825 343 L535 343 A187 187 0 0 0 535 717 L748 717 A32 32 0 0 0 748 653 L535 653 A123 123 0 0 1 535 407 L793 407 Z",
  lower:
    "M522 500 L748 500 A184.5 184.5 0 0 1 748 869 L457 869 L490 805 L748 805 A120.5 120.5 0 0 0 748 564 L522 564 A32 32 0 0 1 522 500 Z",
};

export const MARK_VIEWBOX = "340 333 602 546";

type Props = {
  size?: number | string;
  className?: string;
  /** Render only the outline strokes (used for draw-on animations). */
  outline?: boolean;
  title?: string;
};

export default function SynclinaMark({ size = 32, className, outline = false, title }: Props) {
  const id = useId().replace(/:/g, "");
  const grad = `synclina-grad-${id}`;

  return (
    <svg
      width={size}
      height={typeof size === "number" ? (size * 546) / 602 : undefined}
      viewBox={MARK_VIEWBOX}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={grad} x1="380" y1="860" x2="930" y2="360" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4A12FF" />
          <stop offset="55%" stopColor="#7C22FF" />
          <stop offset="100%" stopColor="#C42BFF" />
        </linearGradient>
      </defs>
      {(["upper", "lower"] as const).map((k) => (
        <path
          key={k}
          data-mark-piece={k}
          d={MARK_PATHS[k]}
          fill={outline ? "none" : `url(#${grad})`}
          stroke={outline ? `url(#${grad})` : undefined}
          strokeWidth={outline ? 4 : undefined}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
