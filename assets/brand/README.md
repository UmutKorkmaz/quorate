# Quorate brand assets

The balanced scales represent independent reviewers reaching one verdict. The gold
point anchors the council; equal pans preserve the mark's symmetry at small sizes.

- `logo.svg`: transparent vector master for web headers and light or dark surfaces.
- `icon.svg` and `icon.png`: navy square for package listings and app icons.
- `logo.png`: transparent avatar for the GitHub App's configured navy badge.
- Website `public/og.svg`: editable 1200 × 630 social card; `og.png` is its raster export.
- VS Code `media/quorate.svg`: monochrome, theme-aware activity bar variant.

Colors: navy `#101827`, blue `#7C9DFF`, gold `#F8BC3C`.
Use the full viewBox without cropping or stretching. It includes the safe area for
circular avatars. Minimum full-color display size: 24 pixels. The monochrome activity bar
variant uses a 24-unit grid and heavier strokes for 16-24 pixel host sizes. Keep the gold accent in full-color
uses; use the monochrome variant when the host controls the icon's color.

Raster exports are rendered from the corresponding SVG at their declared pixel
sizes. Update both masters and copies together when changing the mark.

## Copy and export inventory

| Surface | Asset | Size or form |
| --- | --- | --- |
| Shared listing icon | `assets/brand/icon.png` | 512 × 512 PNG from `icon.svg` |
| GitHub App avatar | `assets/brand/logo.png` | 512 × 512 transparent PNG from `logo.svg` |
| VS Code listing | `packages/vscode/media/icon.png` | 256 × 256 PNG from `icon.svg` |
| VS Code activity bar | `packages/vscode/media/quorate.svg` | Monochrome SVG, 24-unit grid |
| Website header/footer | `packages/website/public/logo.svg` | Copy of `logo.svg` |
| Browser favicon | `packages/website/public/favicon.svg` | Mark with rounded navy background |
| Browser raster favicon | `packages/website/public/favicon.png` | 32 × 32 PNG from favicon SVG |
| Apple touch icon | `packages/website/public/apple-touch-icon.png` | 180 × 180 PNG from `icon.svg` |
| Social cards and repository preview | `packages/website/public/og.png` | 1200 × 630 PNG from `og.svg` |
| CLI monitor header | `packages/cli/src/monitor-page.ts` | Inline mark for the self-contained dashboard |
| App landing header | `packages/github-app/public/index.html` | Inline mark for the self-contained server page |

The social metadata and preview component use `og.png`; `og.svg` remains the
editable artwork. Raster exports contain image pixels without source-file metadata.
