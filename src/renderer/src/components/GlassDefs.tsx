/**
 * SVG filter used through `backdrop-filter: url(#lens)` on floating glass
 * (palette, dialogs, popovers): a gentle edge-weighted displacement that bends
 * whatever terminal text sits behind, like the rim of a lens. Chromium only;
 * the CSS falls back to plain blur when unsupported.
 */
export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="lens" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale="18" xChannelSelector="R" yChannelSelector="G" result="bent" />
        <feGaussianBlur in="bent" stdDeviation="9" result="blurred" />
        <feColorMatrix in="blurred" type="saturate" values="1.6" />
      </filter>
    </svg>
  )
}
