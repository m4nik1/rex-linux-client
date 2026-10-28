import type { JSX } from 'solid-js'

type P = { size?: number; class?: string }
const svg = (children: JSX.Element, p: P, view = '0 0 16 16') => (
  <svg
    class={p.class}
    width={p.size ?? 16}
    height={p.size ?? 16}
    viewBox={view}
    fill="none"
    stroke="currentColor"
    stroke-width="1.35"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const IconSidebar = (p: P) =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="2.2" />
      <path d="M6.2 3v10" />
      <path d="M3.6 5.6h1.2M3.6 7.6h1.2" />
    </>,
    p,
  )
export const IconPlus = (p: P) => svg(<path d="M8 3.2v9.6M3.2 8h9.6" />, p)
export const IconClose = (p: P) => svg(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />, p)
export const IconCommand = (p: P) =>
  svg(
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6Zm0 0h4m-4 0v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0h1.5A1.5 1.5 0 1 1 10 11.5V10Zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6Z" />,
    p,
  )
export const IconEye = (p: P) =>
  svg(
    <>
      <path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </>,
    p,
  )
export const IconSplitRight = (p: P) =>
  svg(
    <>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.8" />
      <path d="M8 3v10" />
    </>,
    p,
  )
export const IconSplitDown = (p: P) =>
  svg(
    <>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.8" />
      <path d="M2.2 8h11.6" />
    </>,
    p,
  )
export const IconZoom = (p: P) =>
  svg(<path d="M9.5 2.8h3.7v3.7M6.5 13.2H2.8V9.5M13.2 2.8 9 7M2.8 13.2 7 9" />, p)
export const IconUnzoom = (p: P) =>
  svg(<path d="M13 7H9V3M3 9h4v4M9 7l4.2-4.2M7 9l-4.2 4.2" />, p)
export const IconMove = (p: P) =>
  svg(
    <path d="M8 1.8v12.4M1.8 8h12.4M8 1.8 6.4 3.4M8 1.8l1.6 1.6M8 14.2l-1.6-1.6M8 14.2l1.6-1.6M1.8 8l1.6-1.6M1.8 8l1.6 1.6M14.2 8l-1.6-1.6M14.2 8l-1.6 1.6" />,
    p,
  )
export const IconServer = (p: P) =>
  svg(
    <>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.4" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1.4" />
      <path d="M5 4.75h.01M5 11.25h.01" />
    </>,
    p,
  )
export const IconGlobe = (p: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.2 8h11.6M8 2.2c1.8 1.7 2.6 3.6 2.6 5.8S9.8 12.1 8 13.8C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.2Z" />
    </>,
    p,
  )
export const IconUsers = (p: P) =>
  svg(
    <>
      <circle cx="6" cy="5.8" r="2.3" />
      <path d="M2 13c.4-2.2 2-3.4 4-3.4s3.6 1.2 4 3.4" />
      <path d="M10.4 3.8a2.2 2.2 0 0 1 0 4.2M11.6 9.8c1.3.4 2.2 1.5 2.4 3.2" />
    </>,
    p,
  )
export const IconPencil = (p: P) =>
  svg(<path d="M10.6 2.9a1.6 1.6 0 0 1 2.3 2.3L6 12.1l-3 .8.8-3 6.8-7Z" />, p)
export const IconTrash = (p: P) =>
  svg(
    <path d="M2.8 4.4h10.4M6.4 4.4V3h3.2v1.4M4.2 4.4l.6 8.4c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.4" />,
    p,
  )
export const IconSearch = (p: P) =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.4" />
      <path d="m10.3 10.3 3.3 3.3" />
    </>,
    p,
  )
export const IconSliders = (p: P) =>
  svg(
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3" />,
    p,
  )
export const IconTerminal = (p: P) =>
  svg(
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
      <path d="m4.6 6.2 2 1.8-2 1.8M8.4 10h3" />
    </>,
    p,
  )
export const IconChevron = (p: P) => svg(<path d="m6 4 4 4-4 4" />, p)
export const IconPlug = (p: P) =>
  svg(
    <path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.2a3.5 3.5 0 0 1-7 0V5.5ZM8 11.2v2.3" />,
    p,
  )
